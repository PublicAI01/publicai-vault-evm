import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { StakingVault, MockERC20 } from "../typechain-types";
import { Signer } from "ethers";

describe("StakingVault", function () {
  let stakingVault: StakingVault;
  let token: MockERC20;
  let owner: Signer;
  let banAccount: Signer;
  let user1: Signer;
  let user2: Signer;
  let user3: Signer;

  const WEEK = 7 * 24 * 60 * 60;
  const DEFAULT_STAKE_AMOUNT = ethers.parseEther("100");
  const DEFAULT_LOCK_DURATION = 4 * WEEK; // 28 days

  beforeEach(async function () {
    [owner, banAccount, user1, user2, user3] = await ethers.getSigners();

    // Deploy MockERC20
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    token = await MockERC20Factory.deploy("Test Token", "TEST");
    await token.waitForDeployment();

    // Deploy StakingVault as upgradeable proxy
    const StakingVaultFactory = await ethers.getContractFactory("StakingVault");
    stakingVault = await upgrades.deployProxy(
      StakingVaultFactory,
      [await token.getAddress(), await banAccount.getAddress()],
      { initializer: "initialize" }
    ) as any;
    await stakingVault.waitForDeployment();

    // Mint tokens to users
    await token.mint(await user1.getAddress(), ethers.parseEther("1000"));
    await token.mint(await user2.getAddress(), ethers.parseEther("1000"));
    await token.mint(await user3.getAddress(), ethers.parseEther("1000"));
  });

  describe("Initialization", function () {
    it("Should initialize with correct values", async function () {
      expect(await stakingVault.owner()).to.equal(await owner.getAddress());
      expect(await stakingVault.tokenContract()).to.equal(await token.getAddress());
      expect(await stakingVault.banId()).to.equal(await banAccount.getAddress());
      expect(await stakingVault.stakeAmount()).to.equal(DEFAULT_STAKE_AMOUNT);
      expect(await stakingVault.lockDuration()).to.equal(DEFAULT_LOCK_DURATION);
      expect(await stakingVault.stakePaused()).to.equal(false);
      expect(await stakingVault.totalStaked()).to.equal(0);
      expect(await stakingVault.totalUser()).to.equal(0);
      expect(await stakingVault.totalBannedAmount()).to.equal(0);
      expect(await stakingVault.totalBannedUser()).to.equal(0);
    });

    it("Should not allow initialization with zero addresses", async function () {
      const StakingVaultFactory = await ethers.getContractFactory("StakingVault");

      await expect(
        upgrades.deployProxy(
          StakingVaultFactory,
          [ethers.ZeroAddress, await banAccount.getAddress()],
          { initializer: "initialize" }
        )
      ).to.be.revertedWith("Invalid token contract");

      await expect(
        upgrades.deployProxy(
          StakingVaultFactory,
          [await token.getAddress(), ethers.ZeroAddress],
          { initializer: "initialize" }
        )
      ).to.be.revertedWith("Invalid ban ID");
    });
  });

  describe("Owner Functions", function () {
    it("Should allow owner to pause/unpause staking", async function () {
      await stakingVault.pauseStake(true);
      expect(await stakingVault.stakePaused()).to.equal(true);

      await stakingVault.pauseStake(false);
      expect(await stakingVault.stakePaused()).to.equal(false);
    });

    it("Should not allow non-owner to pause staking", async function () {
      await expect(
        stakingVault.connect(user1).pauseStake(true)
      ).to.be.revertedWithCustomError(stakingVault, "OwnableUnauthorizedAccount");
    });

    it("Should allow owner to set lock duration", async function () {
      const newDuration = 2 * WEEK;
      await stakingVault.setLockDuration(newDuration);
      expect(await stakingVault.lockDuration()).to.equal(newDuration);
    });

    it("Should not allow non-owner to set lock duration", async function () {
      await expect(
        stakingVault.connect(user1).setLockDuration(1 * WEEK)
      ).to.be.revertedWithCustomError(stakingVault, "OwnableUnauthorizedAccount");
    });

    it("Should allow owner to set stake amount", async function () {
      const newAmount = ethers.parseEther("200");
      await stakingVault.setStakeAmount(newAmount);
      expect(await stakingVault.stakeAmount()).to.equal(newAmount);
    });

    it("Should not allow setting stake amount to 0", async function () {
      await expect(
        stakingVault.setStakeAmount(0)
      ).to.be.revertedWith("Amount must be greater than 0");
    });

    it("Should allow owner to update ban ID", async function () {
      const newBanId = await user3.getAddress();
      await stakingVault.updateBanId(newBanId);
      expect(await stakingVault.banId()).to.equal(newBanId);
    });

    it("Should not allow updating ban ID to zero address", async function () {
      await expect(
        stakingVault.updateBanId(ethers.ZeroAddress)
      ).to.be.revertedWith("New ban ID cannot be zero address");
    });
  });

  describe("Staking", function () {
    it("Should allow user to stake tokens", async function () {
      const stakeAmount = DEFAULT_STAKE_AMOUNT;

      // Approve tokens
      await token.connect(user1).approve(await stakingVault.getAddress(), stakeAmount);

      // Stake
      await expect(stakingVault.connect(user1).stake(stakeAmount))
        .to.emit(stakingVault, "Staked");

      // Check state
      const stakeInfo = await stakingVault.getStakeInfo(await user1.getAddress());
      expect(stakeInfo.amount).to.equal(stakeAmount);
      expect(await stakingVault.totalStaked()).to.equal(stakeAmount);
      expect(await stakingVault.totalUser()).to.equal(1);
    });

    it("Should not allow staking when paused", async function () {
      await stakingVault.pauseStake(true);

      await token.connect(user1).approve(await stakingVault.getAddress(), DEFAULT_STAKE_AMOUNT);

      await expect(
        stakingVault.connect(user1).stake(DEFAULT_STAKE_AMOUNT)
      ).to.be.revertedWith("Staking is paused");
    });

    it("Should not allow staking incorrect amount", async function () {
      const incorrectAmount = ethers.parseEther("50");

      await token.connect(user1).approve(await stakingVault.getAddress(), incorrectAmount);

      await expect(
        stakingVault.connect(user1).stake(incorrectAmount)
      ).to.be.revertedWith("Total stake must equal required amount");
    });

    it("Should handle multiple users staking", async function () {
      // User1 stakes
      await token.connect(user1).approve(await stakingVault.getAddress(), DEFAULT_STAKE_AMOUNT);
      await stakingVault.connect(user1).stake(DEFAULT_STAKE_AMOUNT);

      // User2 stakes
      await token.connect(user2).approve(await stakingVault.getAddress(), DEFAULT_STAKE_AMOUNT);
      await stakingVault.connect(user2).stake(DEFAULT_STAKE_AMOUNT);

      expect(await stakingVault.totalStaked()).to.equal(DEFAULT_STAKE_AMOUNT * 2n);
      expect(await stakingVault.totalUser()).to.equal(2);
    });

    it("Should update stake start time on new stake", async function () {
      await token.connect(user1).approve(await stakingVault.getAddress(), DEFAULT_STAKE_AMOUNT);

      const tx = await stakingVault.connect(user1).stake(DEFAULT_STAKE_AMOUNT);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      const stakeInfo = await stakingVault.getStakeInfo(await user1.getAddress());
      expect(stakeInfo.startTime).to.equal(block!.timestamp);
    });
  });

  describe("Unstaking", function () {
    beforeEach(async function () {
      // User1 stakes tokens
      await token.connect(user1).approve(await stakingVault.getAddress(), DEFAULT_STAKE_AMOUNT);
      await stakingVault.connect(user1).stake(DEFAULT_STAKE_AMOUNT);
    });

    it("Should allow user to unstake after lock period", async function () {
      // Fast forward time past lock duration
      await time.increase(DEFAULT_LOCK_DURATION + 1);

      const balanceBefore = await token.balanceOf(await user1.getAddress());

      await expect(stakingVault.connect(user1).unstake())
        .to.emit(stakingVault, "Unstaked");

      const balanceAfter = await token.balanceOf(await user1.getAddress());

      expect(balanceAfter - balanceBefore).to.equal(DEFAULT_STAKE_AMOUNT);
      expect(await stakingVault.totalStaked()).to.equal(0);
      expect(await stakingVault.totalUser()).to.equal(0);

      const stakeInfo = await stakingVault.getStakeInfo(await user1.getAddress());
      expect(stakeInfo.amount).to.equal(0);
    });

    it("Should not allow unstaking before lock period ends", async function () {
      await expect(
        stakingVault.connect(user1).unstake()
      ).to.be.revertedWith("Lock period not ended");
    });

    it("Should not allow unstaking with no stake", async function () {
      await expect(
        stakingVault.connect(user2).unstake()
      ).to.be.revertedWith("No stake found");
    });

    it("Should allow unstaking exactly at lock period end", async function () {
      await time.increase(DEFAULT_LOCK_DURATION);

      await expect(stakingVault.connect(user1).unstake())
        .to.emit(stakingVault, "Unstaked");
    });
  });

  describe("User State Queries", function () {
    it("Should return correct user stake info", async function () {
      await token.connect(user1).approve(await stakingVault.getAddress(), DEFAULT_STAKE_AMOUNT);
      await stakingVault.connect(user1).stake(DEFAULT_STAKE_AMOUNT);

      const [staked, amount, startTime] = await stakingVault.userStaked(await user1.getAddress());

      expect(staked).to.equal(true);
      expect(amount).to.equal(DEFAULT_STAKE_AMOUNT);
      expect(startTime).to.be.gt(0);
    });

    it("Should return false for non-staked user", async function () {
      const [staked, amount, startTime] = await stakingVault.userStaked(await user2.getAddress());

      expect(staked).to.equal(false);
      expect(amount).to.equal(0);
      expect(startTime).to.equal(0);
    });
  });

  describe("Slashing", function () {
    beforeEach(async function () {
      // User1 stakes tokens
      await token.connect(user1).approve(await stakingVault.getAddress(), DEFAULT_STAKE_AMOUNT);
      await stakingVault.connect(user1).stake(DEFAULT_STAKE_AMOUNT);
    });

    it("Should allow ban account to slash user", async function () {
      await expect(stakingVault.connect(banAccount).slash(await user1.getAddress()))
        .to.emit(stakingVault, "Slashed")
        .withArgs(await user1.getAddress(), DEFAULT_STAKE_AMOUNT);

      // Check user stake is removed
      const stakeInfo = await stakingVault.getStakeInfo(await user1.getAddress());
      expect(stakeInfo.amount).to.equal(0);

      // Check statistics
      expect(await stakingVault.totalBannedAmount()).to.equal(DEFAULT_STAKE_AMOUNT);
      expect(await stakingVault.totalBannedUser()).to.equal(1);
      expect(await stakingVault.totalStaked()).to.equal(0);
      expect(await stakingVault.totalUser()).to.equal(0);
    });

    it("Should not allow non-ban account to slash", async function () {
      await expect(
        stakingVault.connect(user2).slash(await user1.getAddress())
      ).to.be.revertedWith("Only ban account can slash");
    });

    it("Should return false when slashing non-staked user", async function () {
      const result = await stakingVault.connect(banAccount).slash.staticCall(await user2.getAddress());
      expect(result).to.equal(false);
    });

    it("Should handle multiple slashes", async function () {
      // User2 also stakes
      await token.connect(user2).approve(await stakingVault.getAddress(), DEFAULT_STAKE_AMOUNT);
      await stakingVault.connect(user2).stake(DEFAULT_STAKE_AMOUNT);

      // Slash both users
      await stakingVault.connect(banAccount).slash(await user1.getAddress());
      await stakingVault.connect(banAccount).slash(await user2.getAddress());

      expect(await stakingVault.totalBannedAmount()).to.equal(DEFAULT_STAKE_AMOUNT * 2n);
      expect(await stakingVault.totalBannedUser()).to.equal(2);
    });
  });

  describe("Withdraw Banned Tokens", function () {
    beforeEach(async function () {
      // User1 stakes and gets slashed
      await token.connect(user1).approve(await stakingVault.getAddress(), DEFAULT_STAKE_AMOUNT);
      await stakingVault.connect(user1).stake(DEFAULT_STAKE_AMOUNT);
      await stakingVault.connect(banAccount).slash(await user1.getAddress());
    });

    it("Should allow owner to withdraw banned tokens", async function () {
      const withdrawAmount = ethers.parseEther("50");
      const ownerBalanceBefore = await token.balanceOf(await owner.getAddress());

      await expect(stakingVault.withdrawBannedTokens(withdrawAmount))
        .to.emit(stakingVault, "BannedTokensWithdrawn")
        .withArgs(await owner.getAddress(), withdrawAmount);

      const ownerBalanceAfter = await token.balanceOf(await owner.getAddress());
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(withdrawAmount);
      expect(await stakingVault.totalBannedAmount()).to.equal(DEFAULT_STAKE_AMOUNT - withdrawAmount);
    });

    it("Should allow owner to withdraw all banned tokens", async function () {
      await stakingVault.withdrawBannedTokens(DEFAULT_STAKE_AMOUNT);
      expect(await stakingVault.totalBannedAmount()).to.equal(0);
    });

    it("Should not allow withdrawing more than banned amount", async function () {
      const excessAmount = DEFAULT_STAKE_AMOUNT + ethers.parseEther("1");
      await expect(
        stakingVault.withdrawBannedTokens(excessAmount)
      ).to.be.revertedWith("Amount exceeds banned balance");
    });

    it("Should not allow withdrawing 0 tokens", async function () {
      await expect(
        stakingVault.withdrawBannedTokens(0)
      ).to.be.revertedWith("Amount must be greater than 0");
    });

    it("Should not allow non-owner to withdraw banned tokens", async function () {
      await expect(
        stakingVault.connect(user1).withdrawBannedTokens(ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(stakingVault, "OwnableUnauthorizedAccount");
    });
  });

  describe("View Functions", function () {
    it("Should return correct total stake", async function () {
      expect(await stakingVault.getTotalStake()).to.equal(0);

      await token.connect(user1).approve(await stakingVault.getAddress(), DEFAULT_STAKE_AMOUNT);
      await stakingVault.connect(user1).stake(DEFAULT_STAKE_AMOUNT);

      expect(await stakingVault.getTotalStake()).to.equal(DEFAULT_STAKE_AMOUNT);
    });

    it("Should return correct total users", async function () {
      expect(await stakingVault.getTotalUser()).to.equal(0);

      await token.connect(user1).approve(await stakingVault.getAddress(), DEFAULT_STAKE_AMOUNT);
      await stakingVault.connect(user1).stake(DEFAULT_STAKE_AMOUNT);

      expect(await stakingVault.getTotalUser()).to.equal(1);
    });

    it("Should return correct stake amount", async function () {
      expect(await stakingVault.getStakeAmount()).to.equal(DEFAULT_STAKE_AMOUNT);
    });

    it("Should return correct lock duration", async function () {
      expect(await stakingVault.getLockDuration()).to.equal(DEFAULT_LOCK_DURATION);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle changing stake amount between stakes", async function () {
      // Set initial stake amount to 200
      const newStakeAmount = ethers.parseEther("200");
      await stakingVault.setStakeAmount(newStakeAmount);

      // User stakes with new amount
      await token.connect(user1).approve(await stakingVault.getAddress(), newStakeAmount);
      await stakingVault.connect(user1).stake(newStakeAmount);

      const stakeInfo = await stakingVault.getStakeInfo(await user1.getAddress());
      expect(stakeInfo.amount).to.equal(newStakeAmount);
    });

    it("Should handle lock duration changes", async function () {
      // Stake with current lock duration
      await token.connect(user1).approve(await stakingVault.getAddress(), DEFAULT_STAKE_AMOUNT);
      await stakingVault.connect(user1).stake(DEFAULT_STAKE_AMOUNT);

      // Change lock duration
      const newLockDuration = 2 * WEEK;
      await stakingVault.setLockDuration(newLockDuration);

      // Original user should still use old lock duration
      await time.increase(DEFAULT_LOCK_DURATION);
      await expect(stakingVault.connect(user1).unstake()).to.emit(stakingVault, "Unstaked");
    });

    it("Should maintain correct state after multiple operations", async function () {
      // Multiple stakes
      await token.connect(user1).approve(await stakingVault.getAddress(), DEFAULT_STAKE_AMOUNT);
      await stakingVault.connect(user1).stake(DEFAULT_STAKE_AMOUNT);

      await token.connect(user2).approve(await stakingVault.getAddress(), DEFAULT_STAKE_AMOUNT);
      await stakingVault.connect(user2).stake(DEFAULT_STAKE_AMOUNT);

      // Slash one user
      await stakingVault.connect(banAccount).slash(await user1.getAddress());

      // Check state
      expect(await stakingVault.totalStaked()).to.equal(DEFAULT_STAKE_AMOUNT);
      expect(await stakingVault.totalUser()).to.equal(1);
      expect(await stakingVault.totalBannedAmount()).to.equal(DEFAULT_STAKE_AMOUNT);
      expect(await stakingVault.totalBannedUser()).to.equal(1);

      // User2 unstakes after lock period
      await time.increase(DEFAULT_LOCK_DURATION);
      await stakingVault.connect(user2).unstake();

      expect(await stakingVault.totalStaked()).to.equal(0);
      expect(await stakingVault.totalUser()).to.equal(0);
    });
  });

  describe("Upgradeability", function () {
    it("Should be upgradeable", async function () {
      // This test verifies that the contract can be upgraded
      const StakingVaultV2Factory = await ethers.getContractFactory("StakingVault");
      const upgraded = await upgrades.upgradeProxy(
        await stakingVault.getAddress(),
        StakingVaultV2Factory
      );

      // Verify state is preserved
      expect(await upgraded.owner()).to.equal(await owner.getAddress());
      expect(await upgraded.tokenContract()).to.equal(await token.getAddress());
    });
  });
});
