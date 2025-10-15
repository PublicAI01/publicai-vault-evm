# StakingVault - EVM Smart Contract

An upgradeable staking contract that allows users to stake ERC20 tokens for a fixed lock period, with admin controls and a ban system for malicious users.

## Features

- **Upgradeable Contract**: Uses OpenZeppelin's UUPS proxy pattern for future upgrades
- **ERC20 Token Staking**: Users can stake ERC20 tokens for a configurable lock period
- **Owner Controls**: Owner can pause staking, adjust stake amounts, and set lock durations
- **Ban System**: Designated ban account can slash malicious users
- **Banned Token Withdrawal**: Owner can withdraw tokens from banned users
- **Comprehensive Tests**: 38 test cases covering all functionality

## Contract Architecture

### Main Contracts

1. **StakingVault.sol** - Main upgradeable staking contract
   - Inherits from OpenZeppelin's Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable
   - Implements token staking with time locks
   - Provides ban/slash functionality
   - Allows owner to withdraw banned tokens

2. **MockERC20.sol** - Mock ERC20 token for testing

## Installation

```bash
npm install
```

## Compilation

```bash
npx hardhat compile
```

## Testing

Run all tests:
```bash
npx hardhat test
```

Run with gas reporting:
```bash
REPORT_GAS=true npx hardhat test
```

## Deployment

### Local Deployment (with MockERC20)

```bash
npx hardhat run ignition/modules/deploy.ts --network localhost
```

### Production Deployment

Set environment variables:
```bash
export TOKEN_CONTRACT_ADDRESS=<your_erc20_token_address>
export BAN_ACCOUNT_ADDRESS=<ban_account_address>
```

Deploy:
```bash
npx hardhat run ignition/modules/deploy.ts --network <network_name>
```

## Contract API

### Owner Functions

- `pauseStake(bool pause)` - Pause or resume staking
- `setLockDuration(uint64 duration)` - Set lock duration in seconds
- `setStakeAmount(uint128 amount)` - Set required stake amount
- `updateBanId(address newBanId)` - Update ban account address
- `withdrawBannedTokens(uint128 amount)` - Withdraw banned tokens

### User Functions

- `stake(uint128 amount)` - Stake tokens (must approve first)
- `unstake()` - Unstake tokens after lock period

### Ban Account Functions

- `slash(address account)` - Slash a user's stake

### View Functions

- `getStakeInfo(address account)` - Get user's stake information
- `userStaked(address account)` - Check if user has staked
- `getTotalStake()` - Get total staked amount
- `getTotalUser()` - Get total number of staking users
- `getStakeAmount()` - Get required stake amount
- `getLockDuration()` - Get lock duration
- `getTotalBannedAmount()` - Get total banned token amount
- `getTotalBannedUser()` - Get total number of banned users

## Usage Example

```javascript
// 1. Deploy the contract
const stakingVault = await upgrades.deployProxy(
  StakingVault,
  [tokenAddress, banAccountAddress],
  { initializer: "initialize" }
);

// 2. User approves tokens
await token.connect(user).approve(stakingVault.address, stakeAmount);

// 3. User stakes
await stakingVault.connect(user).stake(stakeAmount);

// 4. Wait for lock period to pass (4 weeks by default)

// 5. User unstakes
await stakingVault.connect(user).unstake();
```

## Default Configuration

- **Default Stake Amount**: 100 tokens (100e18 wei)
- **Default Lock Duration**: 28 days (4 weeks)
- **Staking Status**: Active (not paused)

## Security Features

- **ReentrancyGuard**: Protects against reentrancy attacks
- **Ownable**: Restricts admin functions to contract owner
- **Input Validation**: Validates all inputs and states
- **Safe Math**: Uses Solidity 0.8.x built-in overflow protection

## Test Coverage

The test suite includes:
- Initialization tests
- Owner function tests
- Staking functionality tests
- Unstaking tests with time locks
- User state query tests
- Slashing mechanism tests
- Banned token withdrawal tests
- View function tests
- Edge case tests
- Upgradeability tests

All 38 tests pass successfully.

## License

MIT
