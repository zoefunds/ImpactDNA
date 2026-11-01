export const IMPACT_DNA_ESCROW_ABI = [
  "event Deposited(bytes32 indexed epochId, bytes32 indexed depositId, address indexed from, uint256 amount)",
  "event DepositReconciled(bytes32 indexed depositId, bool accepted)",
  "event DepositRefunded(bytes32 indexed depositId, address indexed depositor, uint256 amount)",
  "event GrantsSet(bytes32 indexed epochId, uint256 recipientCount, uint256 totalAllocated)",
  "event EmptyEpochSettled(bytes32 indexed epochId, uint256 unallocatedAmount)",
  "event Claimed(bytes32 indexed epochId, address indexed recipient, uint256 amount)",
  "function deposit(bytes32 epochId, bytes32 depositId, uint256 amount) external",
  "function reconcileDeposit(bytes32 depositId, bool accepted) external",
  "function deposits(bytes32 depositId) external view returns (bytes32 epochId, address depositor, uint256 amount, uint8 status)",
  "function pendingDepositCount(bytes32 epochId) external view returns (uint256)",
  "function refundDeposit(bytes32 depositId) external",
  "function setGrants(bytes32 epochId, address[] recipients, uint256[] amounts) external",
  "function settleEmptyEpoch(bytes32 epochId) external",
  "function claim(bytes32 epochId) external",
  "function getPool(bytes32 epochId) external view returns (uint256 deposited, uint256 allocated, bool grantsSet)",
  "function getPoolState(bytes32 epochId) external view returns (uint256 deposited, uint256 accepted, uint256 allocated, bool grantsSet)",
  "function getClaimable(bytes32 epochId, address recipient) external view returns (uint256)",
  "function getGranted(bytes32 epochId, address recipient) external view returns (uint256)",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
] as const;
