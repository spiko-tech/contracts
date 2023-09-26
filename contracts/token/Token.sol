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

/// @custom:security-contact security@spiko.tech
contract Token is
    ERC20Upgradeable,
    ERC20PausableUpgradeable,
    ERC20PermitUpgradeable,
    ERC1363Upgradeable,
    PermissionManaged,
    UUPSUpgradeable,
    Multicall
{
    error UnauthorizedFrom(address token, address user);
    error UnauthorizedTo(address token, address user);

    uint8 private m_decimals;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IAuthority _authority) PermissionManaged(_authority) {
        _disableInitializers();
    }

    function initialize(string calldata _name, string calldata _symbol, uint8 _decimals) public initializer() {
        __ERC20_init(_name, _symbol);
        __ERC20Permit_init(_name);
        m_decimals = _decimals;
    }

    function decimals() public view virtual override returns (uint8) {
        return m_decimals;
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
    function _update(address from, address to, uint256 amount) internal override(ERC20Upgradeable, ERC20PausableUpgradeable) {
        // sender must be whitelisted, unless its a mint (sender is 0) or its a burn (admin can burn from non-whitelisted account)
        if (from != address(0) && to != address(0) && !authority.canCall(from, address(this), IERC20.transfer.selector)) {
            revert UnauthorizedFrom(address(this), from);
        }

        // receiver must be whitelisted, unless its a burn (receiver is 0)
        if (to != address(0) && !authority.canCall(to, address(this), IERC20.transfer.selector)) {
            revert UnauthorizedTo(address(this), to);
        }

        super._update(from, to, amount);
    }

    /****************************************************************************************************************
     *                                                 UUPS upgrade                                                 *
     ****************************************************************************************************************/
    function _authorizeUpgrade(address) internal view override {
        _checkRestricted(UUPSUpgradeable.upgradeToAndCall.selector);
    }
}
