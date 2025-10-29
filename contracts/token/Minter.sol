// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IAuthority } from "@openzeppelin/contracts/access/manager/IAuthority.sol";
import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { IERC1363Receiver } from "@openzeppelin/contracts/interfaces/IERC1363Receiver.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { Multicall } from "@openzeppelin/contracts/utils/Multicall.sol";
import { PermissionManaged } from "../permissions/PermissionManaged.sol";
import { Token } from "./Token.sol";

/// @custom:security-contact security@spiko.tech
contract Minter is Initializable, PermissionManaged, UUPSUpgradeable, Multicall {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeCast for *;
    using SafeERC20 for Token;

    enum Status {
        NULL,
        BLOCKED,
        EXECUTED,
        CANCELED
    }

    mapping(IERC20 => uint256) public dailyLimit;
    mapping(IERC20 => mapping(uint256 => uint256)) public dailyUsage; // token => day => amount
    mapping(bytes32 => Status) public statuses;

    event DailyLimitUpdated(IERC20 indexed token, uint256 amount);
    event MintBlocked(bytes32 indexed id, address indexed user, IERC20 indexed token, uint256 amount, bytes32 salt);
    event MintExecuted(bytes32 indexed id, address indexed user, IERC20 indexed token, uint256 amount, bytes32 salt);
    event MintCanceled(bytes32 indexed id, address indexed user, IERC20 indexed token, uint256 amount, bytes32 salt);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IAuthority _authority) PermissionManaged(_authority) {
        _disableInitializers();
    }

    /****************************************************************************************************************
     *                                                   Getters                                                    *
     ****************************************************************************************************************/
    /**
     * @dev HELPER: get the current day index (days since epoch)
     */
    function getCurrentDay() public view returns (uint256) {
        return block.timestamp / 1 days;
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
        bytes32 id = hashMintId(user, token, amount, salt);

        require(statuses[id] == Status.NULL, "ID already used");
        require(dailyLimit[token] > 0, "Daily limit not set for token");

        uint256 currentDay = getCurrentDay();
        uint256 currentUsage = dailyUsage[token][currentDay];

        if (currentUsage + amount <= dailyLimit[token]) {
            dailyUsage[token][currentDay] = currentUsage + amount;
            token.mint(user, amount);
            statuses[id] = Status.EXECUTED;
            emit MintExecuted(id, user, token, amount, salt);
        } else {
            statuses[id] = Status.BLOCKED;
            emit MintBlocked(id, user, token, amount, salt);
        }
    }

    /**
     * @dev Execute a pending mint operation
     */
    function approveMint(address user, Token token, uint256 amount, bytes32 salt) external restricted {
        bytes32 id = hashMintId(user, token, amount, salt);

        require(statuses[id] == Status.BLOCKED, "Operation is not blocked");

        token.mint(user, amount);
        statuses[id] = Status.EXECUTED;
        emit MintExecuted(id, user, token, amount, salt);
    }

    /**
     * @dev Cancel a pending mint if the deadline has passed. Can be performed by anyone.
     */
    function cancelMint(address user, Token token, uint256 amount, bytes32 salt) external {
        bytes32 id = hashMintId(user, token, amount, salt);

        require(statuses[id] == Status.BLOCKED, "Operation is not blocked");

        statuses[id] = Status.CANCELED;
        emit MintCanceled(id, user, token, amount, salt);
    }

    /****************************************************************************************************************
     *                                               Admin operations                                               *
     ****************************************************************************************************************/
    /**
     * @dev ADMIN: configure the daily limit for a given token.
     */
    function setDailyLimit(IERC20 token, uint256 amount) external restricted {
        dailyLimit[token] = amount;
        emit DailyLimitUpdated(token, amount);
    }

    /****************************************************************************************************************
     *                                                 UUPS upgrade                                                 *
     ****************************************************************************************************************/
    function _authorizeUpgrade(address) internal view override {
        _checkRestricted(UUPSUpgradeable.upgradeToAndCall.selector);
    }
}
