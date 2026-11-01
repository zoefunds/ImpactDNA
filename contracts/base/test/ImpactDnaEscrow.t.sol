// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../ImpactDnaEscrow.sol";

interface Vm {
    function prank(address) external;
    function expectRevert(bytes calldata) external;
}

contract MockUsdc is IERC20 {
    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowances;
    function mint(address to, uint256 amount) external { balances[to] += amount; }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balances[msg.sender] >= amount, "balance");
        balances[msg.sender] -= amount; balances[to] += amount; return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowances[from][msg.sender] >= amount, "allowance");
        allowances[from][msg.sender] -= amount;
        require(balances[from] >= amount, "balance");
        balances[from] -= amount; balances[to] += amount; return true;
    }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowances[msg.sender][spender] = amount; return true;
    }
    function balanceOf(address account) external view returns (uint256) { return balances[account]; }
    function decimals() external pure returns (uint8) { return 6; }
}

contract ImpactDnaEscrowTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockUsdc token;
    ImpactDnaEscrow escrow;
    address constant RELAYER = address(0xBEEF);
    address constant FUNDER = address(0xA11CE);
    address constant RECIPIENT = address(0xCAFE);
    bytes32 constant EPOCH = keccak256("e-1");

    function setUp() public {
        token = new MockUsdc();
        escrow = new ImpactDnaEscrow(address(token), RELAYER);
        token.mint(FUNDER, 2_000_000);
        vm.prank(FUNDER); token.approve(address(escrow), type(uint256).max);
    }

    function _deposit(bytes32 id, uint256 amount) internal {
        vm.prank(FUNDER); escrow.deposit(EPOCH, id, amount);
    }

    function testActiveCollateralCannotBeWithdrawn() public {
        _deposit(bytes32(uint256(1)), 1_000_000);
        vm.expectRevert(bytes("ImpactDnaEscrow: active epoch collateral locked"));
        escrow.withdrawUnallocated(EPOCH, address(this), 1);
    }

    function testLateReconciliationCreatesExactRefund() public {
        bytes32 id = bytes32(uint256(2));
        _deposit(id, 500_000);
        vm.prank(RELAYER); escrow.reconcileDeposit(id, false);
        vm.prank(FUNDER); escrow.refundDeposit(id);
        (, , , uint8 status) = escrow.deposits(id);
        require(status == 4, "not refunded");
        require(token.balanceOf(FUNDER) == 2_000_000, "refund amount mismatch");
    }

    function testOnlyAcceptedDepositsBackGrantsAndClaims() public {
        bytes32 acceptedId = bytes32(uint256(3));
        bytes32 lateId = bytes32(uint256(4));
        _deposit(acceptedId, 1_000_000);
        _deposit(lateId, 250_000);
        vm.prank(RELAYER); escrow.reconcileDeposit(acceptedId, true);
        address[] memory recipients = new address[](1); recipients[0] = RECIPIENT;
        uint256[] memory amounts = new uint256[](1); amounts[0] = 1_000_000;
        vm.prank(RELAYER); escrow.setGrants(EPOCH, recipients, amounts);
        vm.prank(RELAYER); escrow.reconcileDeposit(lateId, false);
        vm.prank(RECIPIENT); escrow.claim(EPOCH);
        vm.prank(FUNDER); escrow.refundDeposit(lateId);
        require(token.balanceOf(RECIPIENT) == 1_000_000, "claim mismatch");
        require(escrow.getGranted(EPOCH, RECIPIENT) == 1_000_000, "immutable allocation missing");
    }

    function testDepositAfterSettlementReverts() public {
        bytes32 id = bytes32(uint256(5));
        _deposit(id, 1_000_000);
        vm.prank(RELAYER); escrow.reconcileDeposit(id, true);
        address[] memory recipients = new address[](1); recipients[0] = RECIPIENT;
        uint256[] memory amounts = new uint256[](1); amounts[0] = 1_000_000;
        vm.prank(RELAYER); escrow.setGrants(EPOCH, recipients, amounts);
        vm.expectRevert(bytes("ImpactDnaEscrow: epoch settled"));
        vm.prank(FUNDER); escrow.deposit(EPOCH, bytes32(uint256(6)), 1);
    }
}
