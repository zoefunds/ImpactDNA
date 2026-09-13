// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ImpactDnaEscrow
/// @notice Payment layer for ImpactDNA, deployed on Base Sepolia. Holds real
///         USDC funding-epoch pools and lets grant recipients self-claim.
///         Evaluation (impact scores, fraud screening, grant weighting)
///         happens entirely off this chain, on GenLayer
///         (contracts/impact_dna.py) — this contract only ever sees an
///         epoch id, a grant recipient list, and USDC amounts pushed here
///         by a trusted relayer once GenLayer closes an epoch.
/// @dev No external dependencies (no OpenZeppelin import) so it can be
///      compiled/deployed with nothing more than solc — copy in OZ's
///      IERC20/SafeERC20/ReentrancyGuard later if this moves past a
///      testnet build.
// ----------------------------------------------------------------------
// Minimal ERC20 interface (USDC on Base Sepolia).
// ----------------------------------------------------------------------
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

contract ImpactDnaEscrow {
    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------
    struct Pool {
        uint256 deposited;   // total USDC ever deposited under this epoch id
        uint256 allocated;   // total USDC committed to grants via setGrants
        bool grantsSet;      // true once setGrants has run (idempotency gate)
    }

    IERC20 public immutable usdc;
    address public owner;
    address public relayer; // backend service authorized to push grant lists

    mapping(bytes32 => Pool) public pools;                          // epochId => pool
    mapping(bytes32 => mapping(address => uint256)) public claimable; // epochId => recipient => USDC owed
    mapping(address => uint256) public totalClaimable;               // recipient => USDC owed across ALL epochs

    bool private _locked; // reentrancy guard

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------
    event Deposited(bytes32 indexed epochId, address indexed from, uint256 amount);
    event GrantsSet(bytes32 indexed epochId, uint256 recipientCount, uint256 totalAllocated);
    event Claimed(bytes32 indexed epochId, address indexed recipient, uint256 amount);
    event RelayerUpdated(address indexed newRelayer);
    event OwnerUpdated(address indexed newOwner);
    event UnallocatedWithdrawn(bytes32 indexed epochId, address indexed to, uint256 amount);

    // ------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------
    modifier onlyOwner() {
        require(msg.sender == owner, "ImpactDnaEscrow: not owner");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "ImpactDnaEscrow: not relayer");
        _;
    }

    modifier nonReentrant() {
        require(!_locked, "ImpactDnaEscrow: reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    /// @param usdcToken USDC contract address on Base Sepolia.
    /// @param relayer_ Backend service wallet allowed to call setGrants.
    constructor(address usdcToken, address relayer_) {
        require(usdcToken != address(0), "ImpactDnaEscrow: zero usdc");
        require(relayer_ != address(0), "ImpactDnaEscrow: zero relayer");
        usdc = IERC20(usdcToken);
        owner = msg.sender;
        relayer = relayer_;
    }

    // ------------------------------------------------------------------
    // Funding — anyone can deposit USDC into a funding epoch's pool. Caller
    // must have approved this contract for `amount` beforehand.
    // ------------------------------------------------------------------
    function deposit(bytes32 epochId, uint256 amount) external nonReentrant {
        require(amount > 0, "ImpactDnaEscrow: amount must be > 0");
        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        require(ok, "ImpactDnaEscrow: USDC transferFrom failed");
        pools[epochId].deposited += amount;
        emit Deposited(epochId, msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Relayer — pushes the GenLayer-settled grant list exactly once per
    // epoch. Amounts are only credited as claimable, never pushed directly
    // to recipients, so this never has to trust an arbitrary external call
    // succeeding for N recipients in one transaction.
    // ------------------------------------------------------------------
    function setGrants(
        bytes32 epochId,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyRelayer {
        require(recipients.length == amounts.length, "ImpactDnaEscrow: length mismatch");
        require(recipients.length > 0, "ImpactDnaEscrow: no recipients");

        Pool storage pool = pools[epochId];
        require(!pool.grantsSet, "ImpactDnaEscrow: grants already set");

        uint256 total = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            require(recipients[i] != address(0), "ImpactDnaEscrow: zero recipient address");
            total += amounts[i];
        }
        require(
            total <= pool.deposited - pool.allocated,
            "ImpactDnaEscrow: total exceeds undeposited/unallocated pool"
        );

        pool.grantsSet = true;
        pool.allocated += total;

        for (uint256 i = 0; i < recipients.length; i++) {
            if (amounts[i] == 0) continue;
            claimable[epochId][recipients[i]] += amounts[i];
            totalClaimable[recipients[i]] += amounts[i];
        }

        emit GrantsSet(epochId, recipients.length, total);
    }

    // ------------------------------------------------------------------
    // Claims — self-serve pull pattern, checks-effects-interactions.
    // ------------------------------------------------------------------
    function claim(bytes32 epochId) external nonReentrant {
        uint256 amount = claimable[epochId][msg.sender];
        require(amount > 0, "ImpactDnaEscrow: nothing claimable");

        claimable[epochId][msg.sender] = 0;
        totalClaimable[msg.sender] -= amount;

        bool ok = usdc.transfer(msg.sender, amount);
        require(ok, "ImpactDnaEscrow: USDC transfer failed");

        emit Claimed(epochId, msg.sender, amount);
    }

    /// @notice Claim across several epochs in one transaction.
    function claimMany(bytes32[] calldata epochIds) external nonReentrant {
        uint256 total = 0;
        for (uint256 i = 0; i < epochIds.length; i++) {
            bytes32 id = epochIds[i];
            uint256 amount = claimable[id][msg.sender];
            if (amount == 0) continue;
            claimable[id][msg.sender] = 0;
            total += amount;
            emit Claimed(id, msg.sender, amount);
        }
        require(total > 0, "ImpactDnaEscrow: nothing claimable");
        totalClaimable[msg.sender] -= total;
        bool ok = usdc.transfer(msg.sender, total);
        require(ok, "ImpactDnaEscrow: USDC transfer failed");
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------
    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "ImpactDnaEscrow: zero relayer");
        relayer = newRelayer;
        emit RelayerUpdated(newRelayer);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ImpactDnaEscrow: zero owner");
        owner = newOwner;
        emit OwnerUpdated(newOwner);
    }

    /// @notice Owner can pull back USDC that was deposited under an epoch
    ///         but never allocated to grants (e.g. a cancelled epoch, or
    ///         leftover dust below the grant-weight integer rounding).
    ///         Cannot touch anything already allocated/claimable.
    function withdrawUnallocated(bytes32 epochId, address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "ImpactDnaEscrow: zero recipient");
        Pool storage pool = pools[epochId];
        uint256 available = pool.deposited - pool.allocated;
        require(amount <= available, "ImpactDnaEscrow: exceeds unallocated amount");
        pool.deposited -= amount;
        bool ok = usdc.transfer(to, amount);
        require(ok, "ImpactDnaEscrow: USDC transfer failed");
        emit UnallocatedWithdrawn(epochId, to, amount);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------
    function getPool(bytes32 epochId) external view returns (uint256 deposited, uint256 allocated, bool grantsSet) {
        Pool storage pool = pools[epochId];
        return (pool.deposited, pool.allocated, pool.grantsSet);
    }

    function getClaimable(bytes32 epochId, address recipient) external view returns (uint256) {
        return claimable[epochId][recipient];
    }
}
