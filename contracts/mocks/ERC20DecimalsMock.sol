// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20DecimalsMock is ERC20("Mock Token Decimals", "MockD") {
    uint8 internal immutable _decimals;

    constructor(uint8 decimals_) { _decimals = decimals_; }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 value) external {
        _mint(to, value);
    }

    function burn(address to, uint256 value) external {
        _burn(to, value);
    }
}