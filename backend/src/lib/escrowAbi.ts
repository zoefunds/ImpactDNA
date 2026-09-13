export const IMPACT_DNA_ESCROW_ABI = [
  "event Deposited(bytes32 indexed epochId, address indexed from, uint256 amount)",
  "event GrantsSet(bytes32 indexed epochId, uint256 recipientCount, uint256 totalAllocated)",
  "event Claimed(bytes32 indexed epochId, address indexed recipient, uint256 amount)",
  "function deposit(bytes32 epochId, uint256 amount) external",
  "function setGrants(bytes32 epochId, address[] recipients, uint256[] amounts) external",
  "function claim(bytes32 epochId) external",
  "function getPool(bytes32 epochId) external view returns (uint256 deposited, uint256 allocated, bool grantsSet)",
  "function getClaimable(bytes32 epochId, address recipient) external view returns (uint256)",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
] as const;
