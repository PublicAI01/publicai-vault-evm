import { ethers, upgrades } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Get deployment parameters
  // Replace these with your actual token contract address and ban account address
  const tokenContractAddress = process.env.TOKEN_CONTRACT_ADDRESS || "";
  const banAccountAddress = process.env.BAN_ACCOUNT_ADDRESS || deployer.address;

  if (!tokenContractAddress) {
    console.log("\nNo TOKEN_CONTRACT_ADDRESS provided, deploying MockERC20 for testing...");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mockToken = await MockERC20.deploy("Test Token", "TEST");
    await mockToken.waitForDeployment();
    console.log("MockERC20 deployed to:", await mockToken.getAddress());

    // Use the mock token address
    const finalTokenAddress = await mockToken.getAddress();
    console.log("\nDeploying StakingVault with MockERC20...");

    const StakingVault = await ethers.getContractFactory("StakingVault");
    const stakingVault = await upgrades.deployProxy(
      StakingVault,
      [finalTokenAddress, banAccountAddress],
      { initializer: "initialize" }
    );
    await stakingVault.waitForDeployment();

    console.log("StakingVault deployed to:", await stakingVault.getAddress());
    console.log("Ban account:", banAccountAddress);
    console.log("Token contract:", finalTokenAddress);
  } else {
    console.log("\nDeploying StakingVault...");
    const StakingVault = await ethers.getContractFactory("StakingVault");
    const stakingVault = await upgrades.deployProxy(
      StakingVault,
      [tokenContractAddress, banAccountAddress],
      { initializer: "initialize" }
    );
    await stakingVault.waitForDeployment();

    console.log("StakingVault deployed to:", await stakingVault.getAddress());
    console.log("Ban account:", banAccountAddress);
    console.log("Token contract:", tokenContractAddress);
  }

  console.log("\nDeployment completed!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
