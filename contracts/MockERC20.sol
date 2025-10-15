// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @dev Mock ERC20 token for testing purposes
 */
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        // Mint 1 million tokens to deployer
        _mint(msg.sender, 1_000_000 * 10**18);
    }

    /**
     * @dev Mint tokens to any address (for testing)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
