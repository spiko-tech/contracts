// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { UUPSUpgradeable } from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import { Multicall } from "@openzeppelin/contracts/utils/Multicall.sol";
import { IAuthority, PermissionManaged } from "../permissions/PermissionManaged.sol";
import { IERC20, Token } from "./Token.sol";

/// @custom:security-contact security@spiko.tech
contract Minter is PermissionManaged, UUPSUpgradeable, Multicall {
    enum Status {
        NULL,
        BLOCKED,
        EXECUTED,
        CANCELED
    }

    struct MintState {
        Status status;
        uint256 deadline;
    }

    struct DailyUsage {
        uint256 dailyLimit;
        uint256 dailyUsed;
        uint256 lastUsageDay;
    }

    uint256 private _maxDelay;
    mapping(IERC20 => DailyUsage) private _dailyUsage;
    mapping(bytes32 => MintState) private _mintStates;

    event MaxDelayUpdated(uint256 maxDelay);
    event DailyLimitUpdated(IERC20 indexed token, uint256 amount);
    event MintBlocked(bytes32 indexed id, address indexed user, IERC20 indexed token, uint256 amount, bytes32 salt);
    event MintExecuted(bytes32 indexed id);
    event MintCanceled(bytes32 indexed id);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IAuthority _authority) PermissionManaged(_authority) {}

    /****************************************************************************************************************
     *                                                   Getters                                                    *
     ****************************************************************************************************************/
    function maxDelay() public view returns (uint256) {
        return _maxDelay;
    }

    function dailyLimit(IERC20 token) public view returns (uint256) {
        return _dailyUsage[token].dailyLimit;
    }

    function mintStateStatus(bytes32 id) public view returns (Status) {
        return _mintStates[id].status;
    }

    function mintStateDeadline(bytes32 id) public view returns (uint256) {
        return _mintStates[id].deadline;
    }
    /**
     * @dev HELPER: get the current day index (days since epoch)
     */
    function getCurrentDay() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /**
     * @dev HELPER: get the amount minted today for a given token
     */
    function getMintedToday(IERC20 token) public view returns (uint256) {
        DailyUsage storage tokenDailyUsage = _dailyUsage[token];
        return tokenDailyUsage.lastUsageDay == getCurrentDay() ? tokenDailyUsage.dailyUsed : 0;
    }

    /**
     * @dev HELPER: produce mint operation hash from the parameters
     */
    function hashMintId(address user, IERC20 token, uint256 amount, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(user, token, amount, salt));
    }

    /****************************************************************************************************************
     *                                            Mint operations                                             *
     ****************************************************************************************************************/
    /**
     * @dev Initiate a mint operation.
     * If daily limit would be exceeded, creates a pending operation instead of failing.
     */
    function initiateMint(address user, Token token, uint256 amount, bytes32 salt) external restricted {
        DailyUsage storage tokenDailyUsage = _dailyUsage[token];

        bytes32 id = hashMintId(user, token, amount, salt);

        require(_mintStates[id].status == Status.NULL, "ID already used");

        uint256 currentDay = getCurrentDay();
        uint256 currentUsage = getMintedToday(token);

        if (currentUsage + amount > tokenDailyUsage.dailyLimit) {
            _mintStates[id] = MintState({ status: Status.BLOCKED, deadline: block.timestamp + _maxDelay });
            emit MintBlocked(id, user, token, amount, salt);
        } else {
            tokenDailyUsage.lastUsageDay = currentDay;
            tokenDailyUsage.dailyUsed = currentUsage + amount;
            token.mint(user, amount);
            _mintStates[id] = MintState({ status: Status.EXECUTED, deadline: 0 });
            emit MintExecuted(id);
        }
    }

    /**
     * @dev Execute a pending mint operation
     */
    function approveMint(address user, Token token, uint256 amount, bytes32 salt) external restricted {
        bytes32 id = hashMintId(user, token, amount, salt);

        require(_mintStates[id].status == Status.BLOCKED, "Operation is not blocked");
        require(_mintStates[id].deadline > block.timestamp, "Deadline passed");

        _mintStates[id].status = Status.EXECUTED;

        token.mint(user, amount);

        emit MintExecuted(id);
    }

    /**
     * @dev Cancel a pending mint operation
     */
    function cancelMint(address user, Token token, uint256 amount, bytes32 salt) external restricted {
        bytes32 id = hashMintId(user, token, amount, salt);

        require(_mintStates[id].status == Status.BLOCKED, "Operation is not blocked");
        _mintStates[id].status = Status.CANCELED;

        emit MintCanceled(id);
    }

    /****************************************************************************************************************
     *                                               Admin operations                                               *
     ****************************************************************************************************************/
    /**
     * @dev ADMIN: configure the max delay for a mint operation.
     */
    function setMaxDelay(uint256 maxDelay) external restricted {
        _maxDelay = maxDelay;
        emit MaxDelayUpdated(maxDelay);
    }

    /**
     * @dev ADMIN: configure the daily limit for a given token.
     */
    function setDailyLimit(IERC20 token, uint256 amount) external restricted {
        _dailyUsage[token].dailyLimit = amount;
        emit DailyLimitUpdated(token, amount);
    }
    /****************************************************************************************************************
     *                                                 UUPS upgrade                                                 *
     ****************************************************************************************************************/
    function _authorizeUpgrade(address) internal view override {
        _checkRestricted(UUPSUpgradeable.upgradeToAndCall.selector);
    }
}
