// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title StakingVault
 * @dev A staking contract that allows users to stake ERC20 tokens for a fixed period
 * Based on the NEAR lib.rs implementation
 */
contract StakingVault is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable,UUPSUpgradeable {
    // Constants
    uint64 public constant WEEK = 7 * 24 * 60 * 60; // 7 days in seconds
    uint128 public constant DEFAULT_STAKE_AMOUNT = 100e18; // Default 100 tokens (18 decimals)

    // Struct for storing staking information
    struct StakeInfo {
        uint128 amount;      // The principal amount staked by the user
        uint64 startTime;    // Timestamp when staking began
    }

    // State variables
    IERC20 public tokenContract;                            // ERC20 token contract address
    mapping(address => StakeInfo) public stakedBalances;    // User staking information
    uint128 public stakeAmount;                             // Amount required to stake
    uint64 public lockDuration;                             // Lock duration in seconds
    bool public stakePaused;                                // Pause stake flag
    uint128 public totalStaked;                             // Total amount staked
    uint64 public totalUser;                                // Total number of staking users
    address public banId;                                   // Account used to ban users
    uint128 public totalBannedAmount;                       // Total amount of banned tokens
    uint64 public totalBannedUser;                          // Total number of banned users

    // Events
    event Staked(address indexed user, uint128 amount, uint64 timestamp);
    event Unstaked(address indexed user, uint128 amount, uint64 timestamp);
    event Slashed(address indexed user, uint128 amount);
    event StakePausedUpdated(bool paused);
    event LockDurationUpdated(uint64 newDuration);
    event StakeAmountUpdated(uint128 newAmount);
    event BanIdUpdated(address indexed oldBanId, address indexed newBanId);
    event BannedTokensWithdrawn(address indexed owner, uint128 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the contract (replaces constructor for upgradeable contracts)
     * @param _tokenContract ERC20 token contract address
     * @param _banId Account that can ban users
     */
    function initialize(
        address _tokenContract,
        address _banId
    ) public initializer {
        require(_tokenContract != address(0), "Invalid token contract");
        require(_banId != address(0), "Invalid ban ID");

        __Ownable_init(msg.sender);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        tokenContract = IERC20(_tokenContract);
        banId = _banId;
        stakePaused = false;
        lockDuration = 4 * WEEK; // 28 days default
        stakeAmount = DEFAULT_STAKE_AMOUNT;
        totalStaked = 0;
        totalUser = 0;
        totalBannedAmount = 0;
        totalBannedUser = 0;
    }

    /**
     * @dev Authorize upgrade (required by UUPSUpgradeable)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @dev Pause or resume staking (only callable by owner)
     * @param pause If true, staking is paused; if false, staking is resumed
     */
    function pauseStake(bool pause) external onlyOwner {
        stakePaused = pause;
        emit StakePausedUpdated(pause);
    }

    /**
     * @dev Set lock duration (only callable by owner)
     * @param _lockDuration New lock duration in seconds
     */
    function setLockDuration(uint64 _lockDuration) external onlyOwner {
        lockDuration = _lockDuration;
        emit LockDurationUpdated(_lockDuration);
    }

    /**
     * @dev Set stake amount (only callable by owner)
     * @param _stakeAmount New stake amount required
     */
    function setStakeAmount(uint128 _stakeAmount) external onlyOwner {
        require(_stakeAmount > 0, "Amount must be greater than 0");
        stakeAmount = _stakeAmount;
        emit StakeAmountUpdated(_stakeAmount);
    }

    /**
     * @dev Update ban ID (only callable by owner)
     * @param _newBanId New ban ID address
     */
    function updateBanId(address _newBanId) external onlyOwner {
        require(_newBanId != address(0), "New ban ID cannot be zero address");
        address oldBanId = banId;
        banId = _newBanId;
        emit BanIdUpdated(oldBanId, _newBanId);
    }

    /**
     * @dev Stake tokens
     * @param amount Amount of tokens to stake
     */
    function stake(uint128 amount) external nonReentrant {
        require(!stakePaused, "Staking is paused");

        StakeInfo storage userStake = stakedBalances[msg.sender];

        // Check if the total amount equals the required stake amount
        require(
            userStake.amount + amount == stakeAmount,
            "Total stake must equal required amount"
        );

        // If this is a new stake, increment user count
        if (userStake.amount == 0) {
            totalUser += 1;
        }

        // Transfer tokens from user to contract
        require(
            tokenContract.transferFrom(msg.sender, address(this), amount),
            "Token transfer failed"
        );

        // Update stake info
        userStake.amount += amount;
        userStake.startTime = uint64(block.timestamp);
        totalStaked += amount;

        emit Staked(msg.sender, amount, uint64(block.timestamp));
    }

    /**
     * @dev Unstake all principal
     */
    function unstake() external nonReentrant {
        StakeInfo memory userStake = stakedBalances[msg.sender];
        require(userStake.amount > 0, "No stake found");

        // Check if lock period has passed
        require(
            block.timestamp >= userStake.startTime + lockDuration,
            "Lock period not ended"
        );

        uint128 amount = userStake.amount;

        // Remove stake info
        delete stakedBalances[msg.sender];
        totalStaked -= amount;
        totalUser -= 1;

        // Transfer tokens back to user
        require(
            tokenContract.transfer(msg.sender, amount),
            "Token transfer failed"
        );

        emit Unstaked(msg.sender, amount, uint64(block.timestamp));
    }

    /**
     * @dev Slash a user's stake (only callable by ban account)
     * @param account User account to slash
     */
    function slash(address account) external returns (bool) {
        require(msg.sender == banId, "Only ban account can slash");

        StakeInfo memory userStake = stakedBalances[account];
        if (userStake.amount == 0) {
            return false;
        }

        uint128 amount = userStake.amount;

        // Update banned statistics
        totalBannedAmount += amount;
        totalBannedUser += 1;

        // Update staking statistics
        totalStaked -= amount;
        totalUser -= 1;

        // Remove stake info
        delete stakedBalances[account];

        emit Slashed(account, amount);
        return true;
    }

    /**
     * @dev Withdraw banned tokens (only callable by owner)
     * @param amount Amount to withdraw
     */
    function withdrawBannedTokens(uint128 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(amount <= totalBannedAmount, "Amount exceeds banned balance");

        totalBannedAmount -= amount;

        require(
            tokenContract.transfer(msg.sender, amount),
            "Token transfer failed"
        );

        emit BannedTokensWithdrawn(msg.sender, amount);
    }

    /**
     * @dev Get stake info for a user
     * @param account User account
     * @return StakeInfo struct containing user's stake data
     */
    function getStakeInfo(address account) external view returns (StakeInfo memory) {
        return stakedBalances[account];
    }

    /**
     * @dev Check if user has staked
     * @param account User account
     * @return staked Whether user meets stake requirements
     * @return amount User's staked amount
     * @return startTime When staking began
     */
    function userStaked(address account) external view returns (
        bool staked,
        uint128 amount,
        uint64 startTime
    ) {
        StakeInfo memory userStake = stakedBalances[account];
        staked = userStake.amount >= stakeAmount;
        amount = userStake.amount;
        startTime = userStake.startTime;
    }

    /**
     * @dev Get total staked amount
     */
    function getTotalStake() external view returns (uint128) {
        return totalStaked;
    }

    /**
     * @dev Get total number of staking users
     */
    function getTotalUser() external view returns (uint64) {
        return totalUser;
    }

    /**
     * @dev Get required stake amount
     */
    function getStakeAmount() external view returns (uint128) {
        return stakeAmount;
    }

    /**
     * @dev Get lock duration
     */
    function getLockDuration() external view returns (uint64) {
        return lockDuration;
    }

    /**
     * @dev Get total banned amount
     */
    function getTotalBannedAmount() external view returns (uint128) {
        return totalBannedAmount;
    }

    /**
     * @dev Get total number of banned users
     */
    function getTotalBannedUser() external view returns (uint64) {
        return totalBannedUser;
    }
}
