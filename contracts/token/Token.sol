// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import "./extensions/ERC1363Upgradeable.sol";
import "../permissions/PermissionManaged.sol";

/// @custom:security-contact TODO
/// @custom:oz-upgrades-unsafe-allow state-variable-immutable
contract Token is
    ERC20Upgradeable,
    ERC20PausableUpgradeable,
    ERC20PermitUpgradeable,
    ERC1363Upgradeable,
    PermissionManaged,
    UUPSUpgradeable,
    Multicall
{
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IAuthority _authority) PermissionManaged(_authority) {
        _disableInitializers();
    }

    function initialize(string calldata _name, string calldata _symbol) public initializer() {
        __ERC20_init(_name, _symbol);
        __ERC20Permit_init(_name);
    }

    /****************************************************************************************************************
     *                                               Admin operations                                               *
     ****************************************************************************************************************/
    function mint(address to, uint256 amount) public restricted() {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) public restricted() {
        _burn(from, amount);
    }

    function pause() public restricted() {
        _pause();
    }

    function unpause() public restricted() {
        _unpause();
    }

    /****************************************************************************************************************
     *                                           Token transfer whitelist                                           *
     ****************************************************************************************************************/
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override(ERC20Upgradeable, ERC20PausableUpgradeable) {
        // sender must be whitelisted, unless its a mint (sender is 0) or its a burn (admin can burn from non-whitelisted account)
        require(
            from == address(0) ||
            to   == address(0) ||
            authority.canCall(from, address(this), IERC20.transfer.selector),
            "unauthorized from"
        );

        // receiver must be whitelisted, unless its a burn (receiver is 0)
        require(
            to == address(0) ||
            authority.canCall(to, address(this), IERC20.transfer.selector),
            "unauthorized to"
        );

        super._beforeTokenTransfer(from, to, amount);
    }

    /****************************************************************************************************************
     *                                                 UUPS upgrade                                                 *
     ****************************************************************************************************************/
    function _authorizeUpgrade(address implementation) internal view override {
        _checkRestricted(UUPSUpgradeable.upgradeTo.selector);
        super._authorizeUpgrade(implementation);
    }
}
