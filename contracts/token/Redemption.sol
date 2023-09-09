// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./Token.sol";

/// @custom:security-contact TODO
/// @custom:oz-upgrades-unsafe-allow state-variable-immutable
contract Redemption is
    IERC1363Receiver,
    PermissionManaged,
    Multicall
{
    using SafeCast for *;
    using SafeERC20 for IERC20;

    enum Status {
        NULL,
        PENDING,
        EXECUTED,
        CANCELED
    }

    struct Details {
        Status status;
        uint48 deadline;
    }

    uint48                      public constant MAX_DELAY = 7 days;
    mapping(bytes32 => Details) public          details;
    mapping(IERC20  => IERC20 ) public          outputFor;

    event RedemptionInitiated(bytes32 indexed id, address indexed user, IERC20 indexed input, IERC20 output, uint256 inputValue, bytes32 salt);
    event RedemptionExecuted(bytes32 indexed id, uint256 outputValue);
    event RedemptionCanceled(bytes32 indexed id);
    event OutputForUpdate(IERC20 indexed input, IERC20 indexed output);

    constructor(IAuthority _authority) PermissionManaged(_authority) {}

    function onTransferReceived(
        address /* operator */,
        address user,
        uint256 value,
        bytes calldata data
    ) external returns (bytes4) {
        // Fetch input params
        IERC20 input  = IERC20(msg.sender);
        (IERC20 output, bytes32 salt) = abi.decode(data, (IERC20, bytes32));

        // Check that output is set → input is registered
        require(output == outputFor[input], "TODO");

        // Hash operation
        bytes32 id = hashRedemptionId(user, input, output, value, salt);

        // Check that operation id is not yet used
        require(details[id].status == Status.NULL, "TODO"); // no operation set with this ID yet

        // Register details
        details[id] = Details({ status: Status.PENDING, deadline: block.timestamp.toUint48() + MAX_DELAY });

        // Emit event
        emit RedemptionInitiated(id, user, input, output, value, salt);

        return IERC1363Receiver.onTransferReceived.selector;
    }

    /**
     * @dev Execute a redemption request
     */
    function executeRedemption(
        address user,
        IERC20  input,
        IERC20  output,
        uint256 inputValue,
        uint256 outputValue,
        bytes32 salt
    ) external restricted() {
        // Hash operation
        bytes32 id = hashRedemptionId(user, input, output, inputValue, salt);

        // Check that operation exist and is active
        require(details[id].status == Status.PENDING, "TODO");
        require(details[id].deadline > block.timestamp, "TODO");

        // Mark operation as execution
        details[id].status = Status.EXECUTED;

        // Burn input tokens, and send output token to user.
        // TODO: where do the output tokens come from ?
        Token(address(input)).burn(address(this), inputValue);
        output.safeTransferFrom(msg.sender, user, outputValue);

        // Emit event
        emit RedemptionExecuted(id, outputValue);
    }

    /**
     * @dev Cancel a redemption if the execution delay has passed. Can be performed by anyone. Input tokens are
     * refunded to the user and the operation is marked as `CANCELED`.
     */
    function cancelRedemption(
        address user,
        IERC20 input,
        IERC20 output,
        uint256 inputValue,
        bytes32 salt
    ) external {
        // Hash operation
        bytes32 id = hashRedemptionId(user, input, output, inputValue, salt);

        // Check that operation exist and deadline is passed
        require(details[id].status == Status.PENDING, "TODO");
        require(details[id].deadline <= block.timestamp, "TODO");

        // Mark operation as canceled
        details[id].status = Status.CANCELED;

        // Refund user
        input.safeTransfer(user, inputValue);

        // Emit event
        emit RedemptionCanceled(id);
    }

    /**
     * @dev ADMIN: configure which output (stablecoin) is used for redemptions of a given input.
     */
    function registerOutput(IERC20 input, IERC20 output) external restricted() {
        outputFor[input] = output;

        emit OutputForUpdate(input, output);
    }

    /**
     * @dev HELPER: produce redemption request hash from the input parameters
     */
    function hashRedemptionId(address user, IERC20 input, IERC20 output, uint256 inputValue, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(user, input, output, inputValue, salt));
    }
}