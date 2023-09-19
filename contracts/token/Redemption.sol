// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./Token.sol";

/// @custom:security-contact TODO
contract Redemption is
    IERC1363Receiver,
    Initializable,
    PermissionManaged,
    UUPSUpgradeable,
    Multicall
{
    using EnumerableSet for EnumerableSet.AddressSet;
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

    uint48                                       public constant MAX_DELAY = 7 days;
    mapping(bytes32 => Details                 ) public          details;
    mapping(IERC20  => EnumerableSet.AddressSet) private         _outputs;

    event RedemptionInitiated(bytes32 indexed id, address indexed user, IERC20 indexed input, address output, uint256 inputValue, bytes32 salt);
    event RedemptionExecuted(bytes32 indexed id, bytes data);
    event RedemptionCanceled(bytes32 indexed id);
    event EnableOutput(IERC20 indexed input, address output, bool enable);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IAuthority _authority) PermissionManaged(_authority) {
        _disableInitializers();
    }

    /****************************************************************************************************************
     *                                                   Getters                                                    *
     ****************************************************************************************************************/
    /**
     * @dev Getter: list all authorized output for a given input.
     */
    function outputsFor(IERC20 input) external view returns (address[] memory) {
        return _outputs[input].values();
    }

    /**
     * @dev HELPER: produce redemption request hash from the input parameters
     */
    function hashRedemptionId(address user, IERC20 input, address output, uint256 inputValue, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(user, input, output, inputValue, salt));
    }

    /****************************************************************************************************************
     *                                            Redemption operations                                             *
     ****************************************************************************************************************/
    /**
     * @dev Initiate a redemption operation.
     *
     * Input tokens are ERC-1363. This is triggered by transferAndCall of transferFromAndCall.
     */
    function onTransferReceived(
        address user,
        address /* from */,
        uint256 value,
        bytes calldata data
    ) external returns (bytes4) {
        // Fetch input params
        IERC20 input  = IERC20(msg.sender);
        (address output, bytes32 salt) = abi.decode(data, (address, bytes32));

        // Check that output is fiat (address(0)), or if the output is registered for the input
        require(
            output == address(0) || _outputs[input].contains(output),
            "Input/Output pair is not authorized"
        );

        // Hash operation
        bytes32 id = hashRedemptionId(user, input, output, value, salt);

        // Check that operation id is not yet used
        require(details[id].status == Status.NULL, "ID already used");

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
        address output,
        uint256 inputValue,
        bytes32 salt,
        bytes calldata data
    ) external restricted() {
        // Hash operation
        bytes32 id = hashRedemptionId(user, input, output, inputValue, salt);

        // Check that operation exist and is active
        require(details[id].status == Status.PENDING, "Operation is not pending");
        require(details[id].deadline > block.timestamp, "Deadline passed");

        // Mark operation as execution
        details[id].status = Status.EXECUTED;

        // Burn input tokens.
        Token(address(input)).burn(address(this), inputValue);

        // Emit event
        emit RedemptionExecuted(id, data);
    }

    /**
     * @dev Cancel a redemption if the execution delay has passed. Can be performed by anyone. Input tokens are
     * refunded to the user and the operation is marked as `CANCELED`.
     */
    function cancelRedemption(
        address user,
        IERC20  input,
        address output,
        uint256 inputValue,
        bytes32 salt
    ) external {
        // Hash operation
        bytes32 id = hashRedemptionId(user, input, output, inputValue, salt);

        // Check that operation exist and deadline is passed
        require(details[id].status == Status.PENDING, "Operation is not pending");
        require(details[id].deadline <= block.timestamp, "Deadline not passed");

        // Mark operation as canceled
        details[id].status = Status.CANCELED;

        // Refund user
        input.safeTransfer(user, inputValue);

        // Emit event
        emit RedemptionCanceled(id);
    }

    /****************************************************************************************************************
     *                                               Admin operations                                               *
     ****************************************************************************************************************/
    /**
     * @dev ADMIN: configure which output (stablecoin) is used for redemptions of a given input.
     */
    function registerOutput(IERC20 input, address output, bool enable) external restricted() {
        if (enable) {
            _outputs[input].add(output);
        } else {
            _outputs[input].remove(output);
        }

        emit EnableOutput(input, output, enable);
    }

    /****************************************************************************************************************
     *                                                 UUPS upgrade                                                 *
     ****************************************************************************************************************/
    function _authorizeUpgrade(address) internal view override {
        _checkRestricted(UUPSUpgradeable.upgradeToAndCall.selector);
    }
}