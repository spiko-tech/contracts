// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock is ERC20("Mock Token", "Mock") {
    function mint(address to, uint256 value) external {
        _mint(to, value);
    }

    function burn(address to, uint256 value) external {
        _burn(to, value);
    }
}