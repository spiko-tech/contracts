// SPDX-License-Identifier: MIT

pragma solidity ^0.8.27;

import { IAuthority } from "@openzeppelin/contracts/access/manager/IAuthority.sol";
import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { Multicall } from "@openzeppelin/contracts/utils/Multicall.sol";
import { Oracle } from "../oracle/Oracle.sol";
import { PermissionManaged } from "../permissions/PermissionManaged.sol";
import { Redemption } from "./Redemption.sol";
import { Token } from "./Token.sol";

/**
 * @dev Instant redemption of fund tokens against stablecoins.
 *
 * The user is paid immediately from a stablecoin buffer held by this contract. The fund tokens are then submitted to
 * the {Redemption} contract as a regular request owned by this contract, so that its settlement repays the buffer.
 */
/// @custom:security-contact security@spiko.tech
contract InstantRedemption is Initializable, PermissionManaged, UUPSUpgradeable, Multicall {
    using Math for *;
    using SafeCast for *;
    using SafeERC20 for IERC20;

    struct Pair {
        Oracle oracle;
        uint48 oracleTTL;
        uint256 numerator; // 10 ** stablecoin.decimals()
        uint256 denominator; // 10 ** (token.decimals() + oracle.decimals())
    }

    struct Usage {
        uint48 day; // block.timestamp / 1 days
        uint208 amount; // stablecoin redeemed during that day
    }

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    Redemption public immutable redemption;

    mapping(bytes32 pairId => Pair) private _pairs;
    mapping(bytes32 pairId => mapping(address user => uint256)) private _dailyLimit;
    mapping(bytes32 pairId => mapping(address user => Usage)) private _usage;

    event InstantRedemptionExecuted(
        bytes32 indexed pairId,
        address indexed user,
        Token indexed token,
        IERC20 stablecoin,
        uint256 inputAmount,
        uint256 outputAmount,
        bytes32 redemptionId
    );
    event PairUpdated(
        bytes32 indexed pairId,
        Token indexed token,
        IERC20 indexed stablecoin,
        Oracle oracle,
        uint48 oracleTTL
    );
    event PairRemoved(bytes32 indexed pairId, Token indexed token, IERC20 indexed stablecoin);
    event DailyLimitUpdated(
        bytes32 indexed pairId,
        address indexed user,
        Token indexed token,
        IERC20 stablecoin,
        uint256 limit
    );

    error UnknownPair(Token token, IERC20 stablecoin);
    error OracleTokenMismatch(Oracle oracle, Token token);
    error OracleValueTooOld(Oracle oracle);
    error OutputAmountTooLow(uint256 outputAmount, uint256 minOutputAmount);
    error DailyLimitExceeded(address user, uint256 requested, uint256 remaining);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IAuthority _authority, Redemption _redemption) PermissionManaged(_authority) {
        redemption = _redemption;
        _disableInitializers();
    }

    /****************************************************************************************************************
     *                                                   Getters                                                    *
     ****************************************************************************************************************/
    function hashPair(Token token, IERC20 stablecoin) public pure returns (bytes32) {
        return keccak256(abi.encode(token, stablecoin));
    }

    function viewPair(Token token, IERC20 stablecoin) public view returns (Pair memory) {
        return _pairs[hashPair(token, stablecoin)];
    }

    function dailyLimit(Token token, IERC20 stablecoin, address user) public view returns (uint256) {
        return _dailyLimit[hashPair(token, stablecoin)][user];
    }

    function remainingDailyLimit(Token token, IERC20 stablecoin, address user) public view returns (uint256) {
        bytes32 pairId = hashPair(token, stablecoin);
        Usage memory usage = _usage[pairId][user];
        uint256 used = Math.ternary(usage.day == block.timestamp / 1 days, usage.amount, 0);
        // saturating: the limit may be lowered below what was already used today
        return _dailyLimit[pairId][user].saturatingSub(used);
    }

    function previewRedeem(Token token, IERC20 stablecoin, uint256 amount) public view returns (uint256) {
        Pair memory pair = viewPair(token, stablecoin);
        require(address(pair.oracle) != address(0), UnknownPair(token, stablecoin));
        return
            amount.mulDiv(
                pair.numerator * _getLatestPrice(pair.oracle, pair.oracleTTL),
                pair.denominator,
                Math.Rounding.Floor
            );
    }

    function _getLatestPrice(Oracle oracle, uint256 oracleTTL) internal view returns (uint256) {
        (, int256 price, , uint256 updatedAt, ) = oracle.latestRoundData();
        require(block.timestamp < updatedAt + oracleTTL, OracleValueTooOld(oracle));
        return price.toUint256();
    }

    /****************************************************************************************************************
     *                                            Redemption operations                                             *
     ****************************************************************************************************************/
    function redeem(
        Token token,
        IERC20 stablecoin,
        uint256 amount,
        uint256 minOutputAmount,
        bytes32 salt
    ) external restricted returns (uint256 outputAmount) {
        bytes32 pairId = hashPair(token, stablecoin);
        outputAmount = previewRedeem(token, stablecoin, amount);
        // a zero output (zero price, zero or dust amount) would take the tokens for nothing
        uint256 minimum = Math.max(minOutputAmount, 1);
        require(outputAmount >= minimum, OutputAmountTooLow(outputAmount, minimum));

        // Check and consume the daily limit
        uint256 remaining = remainingDailyLimit(token, stablecoin, msg.sender);
        require(outputAmount <= remaining, DailyLimitExceeded(msg.sender, outputAmount, remaining));
        Usage storage usage = _usage[pairId][msg.sender];
        uint48 today = (block.timestamp / 1 days).toUint48();
        if (usage.day != today) (usage.day, usage.amount) = (today, 0);
        usage.amount += outputAmount.toUint208();

        // Advance: fund tokens in, stablecoin out of the buffer
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        stablecoin.safeTransfer(msg.sender, outputAmount);

        // Repayment: Redemption request owned by this contract, settled in stablecoin back to this contract.
        // Reverts (bubbled up) if the output is not registered, the amount is below Redemption's minimum, or the
        // request id is already used. All requests are owned by this contract, so salts are shared across callers.
        token.transferAndCall(address(redemption), amount, abi.encode(stablecoin, salt));
        bytes32 redemptionId = redemption.hashRedemptionId(address(this), token, address(stablecoin), amount, salt);

        emit InstantRedemptionExecuted(pairId, msg.sender, token, stablecoin, amount, outputAmount, redemptionId);
    }

    /****************************************************************************************************************
     *                                               Admin operations                                               *
     ****************************************************************************************************************/
    function setPair(Token token, IERC20Metadata stablecoin, Oracle oracle, uint48 oracleTTL) external restricted {
        require(address(oracle.token()) == address(token), OracleTokenMismatch(oracle, token));
        bytes32 pairId = hashPair(token, stablecoin);
        _pairs[pairId] = Pair({
            oracle: oracle,
            oracleTTL: oracleTTL,
            numerator: 10 ** stablecoin.decimals(),
            denominator: 10 ** (token.decimals() + oracle.decimals())
        });

        emit PairUpdated(pairId, token, stablecoin, oracle, oracleTTL);
    }

    function removePair(Token token, IERC20 stablecoin) external restricted {
        bytes32 pairId = hashPair(token, stablecoin);
        delete _pairs[pairId];

        emit PairRemoved(pairId, token, stablecoin);
    }

    function setDailyLimit(Token token, IERC20 stablecoin, address user, uint256 limit) external restricted {
        bytes32 pairId = hashPair(token, stablecoin);
        _dailyLimit[pairId][user] = limit;

        emit DailyLimitUpdated(pairId, user, token, stablecoin, limit);
    }

    /**
     * @dev ADMIN: manage the stablecoin buffer, collect the repayment surplus, and recover fund tokens refunded by a
     * canceled redemption request.
     */
    function withdraw(IERC20 token, address to, uint256 amount) external restricted {
        token.safeTransfer(to, amount == type(uint256).max ? token.balanceOf(address(this)) : amount);
    }

    /****************************************************************************************************************
     *                                                 UUPS upgrade                                                 *
     ****************************************************************************************************************/
    function _authorizeUpgrade(address) internal view override {
        _checkRestricted(UUPSUpgradeable.upgradeToAndCall.selector);
    }
}
