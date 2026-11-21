// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title AevifyCheckout
 * @notice Stablecoin checkout for online stores and AI agents on QDay Aevum Testnet.
 *
 * How a payment works:
 *  1. A merchant's server asks the Aevify API for a payment request. The Aevify backend
 *     signs it (EIP-712) with the `signer` key, fixing the amount, merchant and expiry.
 *  2. The customer (a person through the checkout, or an AI agent in code) calls `pay`
 *     with that request and signature.
 *  3. The contract checks the signature, then moves tUSD8 straight from the payer:
 *     the fee to Aevify, the rest to the merchant's payout wallet. It never holds funds.
 *
 * Safety controls:
 *  - Signed requests: amounts can't be tampered with in the browser.
 *  - Each request can be paid once, and only before it expires.
 *  - The fee can never exceed MAX_FEE_BPS (5%), not even by the owner.
 *  - A merchant's payout wallet changes only after a 24-hour delay, and the current
 *    payout wallet can cancel the change. This protects against hijacked accounts.
 *  - Refunds come from the merchant's own wallet back to the original payer.
 *  - Emergency pause stops new payments. Refunds still work while paused.
 *  - Ownership moves in two steps and can't be renounced.
 */
contract AevifyCheckout is Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice Hard ceiling on the fee: 500 basis points = 5%.
    uint16 public constant MAX_FEE_BPS = 500;

    /// @notice How long a payout wallet change waits before it can be applied.
    uint64 public constant PAYOUT_CHANGE_DELAY = 24 hours;

    uint16 private constant BPS_DENOMINATOR = 10_000;

    bytes32 public constant PAYMENT_REQUEST_TYPEHASH = keccak256(
        "PaymentRequest(bytes32 paymentId,bytes32 merchantId,uint256 amount,uint64 expiresAt,address payer)"
    );

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @notice A payment request, as signed by the Aevify backend.
    /// @param paymentId Unique ID chosen by Aevify for this payment.
    /// @param merchantId ID of the merchant registered in this contract.
    /// @param amount Amount in token base units (tUSD8 has 6 decimals).
    /// @param expiresAt Unix timestamp after which the request can't be paid.
    /// @param payer Only this address may pay; address(0) lets anyone pay.
    struct PaymentRequest {
        bytes32 paymentId;
        bytes32 merchantId;
        uint256 amount;
        uint64 expiresAt;
        address payer;
    }

    struct Merchant {
        address payout;
        address pendingPayout;
        uint64 pendingPayoutAt;
    }

    struct Payment {
        address payer;
        bytes32 merchantId;
        uint256 amount;
        uint256 fee;
        uint256 refunded;
        uint64 paidAt;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice The stablecoin accepted for payments (tUSD8 on Aevum).
    IERC20 public immutable token;

    /// @notice Backend key that signs payment requests. It never sends transactions.
    address public signer;

    /// @notice Backend key that registers merchants and can pause in an emergency.
    address public operator;

    /// @notice Where fees go.
    address public feeRecipient;

    /// @notice Current fee in basis points (300 = 3%).
    uint16 public feeBps;

    mapping(bytes32 merchantId => Merchant) private _merchants;
    mapping(bytes32 paymentId => Payment) private _payments;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event PaymentPaid(
        bytes32 indexed paymentId,
        bytes32 indexed merchantId,
        address indexed payer,
        address payout,
        uint256 amount,
        uint256 fee
    );
    event PaymentRefunded(
        bytes32 indexed paymentId,
        bytes32 indexed merchantId,
        address indexed payer,
        uint256 amount,
        uint256 totalRefunded
    );
    event MerchantRegistered(bytes32 indexed merchantId, address indexed payout);
    event PayoutChangeRequested(
        bytes32 indexed merchantId, address indexed currentPayout, address indexed newPayout, uint64 effectiveAt
    );
    event PayoutChanged(bytes32 indexed merchantId, address indexed oldPayout, address indexed newPayout);
    event PayoutChangeCancelled(bytes32 indexed merchantId, address indexed cancelledPayout);
    event FeeUpdated(uint16 oldFeeBps, uint16 newFeeBps);
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error FeeTooHigh(uint16 feeBps, uint16 maxFeeBps);
    error InvalidAmount();
    error InvalidMerchantId();
    error RequestExpired(uint64 expiresAt);
    error PayerMismatch(address expected, address actual);
    error AlreadyPaid(bytes32 paymentId);
    error UnknownMerchant(bytes32 merchantId);
    error MerchantExists(bytes32 merchantId);
    error UnknownPayment(bytes32 paymentId);
    error InvalidSignature();
    error Unauthorized();
    error NoPendingPayoutChange(bytes32 merchantId);
    error PayoutChangeNotReady(uint64 effectiveAt);
    error RenounceDisabled();

    // ---------------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------------

    constructor(
        IERC20 token_,
        address owner_,
        address signer_,
        address operator_,
        address feeRecipient_,
        uint16 feeBps_
    ) Ownable(owner_) EIP712("Aevify Checkout", "1") {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        _setSigner(signer_);
        _setOperator(operator_);
        _setFeeRecipient(feeRecipient_);
        _setFeeBps(feeBps_);
    }

    modifier onlyOperatorOrOwner() {
        if (msg.sender != operator && msg.sender != owner()) revert Unauthorized();
        _;
    }

    // ---------------------------------------------------------------------
    // Payments
    // ---------------------------------------------------------------------

    /// @notice Pay a signed payment request. The caller must have approved this
    ///         contract to spend at least `req.amount` of the token.
    /// @return fee The fee taken, in token base units.
    function pay(PaymentRequest calldata req, bytes calldata signature)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 fee)
    {
        return _pay(req, signature);
    }

    /// @notice Approve and pay in one transaction, for tokens that support EIP-2612 permit.
    /// @dev If the permit call fails (unsupported, or already used by a front-runner),
    ///      payment still goes ahead when an allowance already exists.
    function payWithPermit(
        PaymentRequest calldata req,
        bytes calldata signature,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused nonReentrant returns (uint256 fee) {
        try IERC20Permit(address(token)).permit(msg.sender, address(this), req.amount, deadline, v, r, s) {}
        catch {}
        return _pay(req, signature);
    }

    /// @notice Refund some or all of a payment to the original payer.
    /// @dev Called by the merchant's payout wallet, which must approve this contract
    ///      for `amount`. Works even while the contract is paused.
    function refund(bytes32 paymentId, uint256 amount) external nonReentrant {
        Payment storage p = _payments[paymentId];
        if (p.paidAt == 0) revert UnknownPayment(paymentId);
        if (msg.sender != _merchants[p.merchantId].payout) revert Unauthorized();
        if (amount == 0 || p.refunded + amount > p.amount) revert InvalidAmount();

        p.refunded += amount;
        token.safeTransferFrom(msg.sender, p.payer, amount);

        emit PaymentRefunded(paymentId, p.merchantId, p.payer, amount, p.refunded);
    }

    function _pay(PaymentRequest calldata req, bytes calldata signature) private returns (uint256 fee) {
        if (req.amount == 0) revert InvalidAmount();
        if (block.timestamp > req.expiresAt) revert RequestExpired(req.expiresAt);
        if (req.payer != address(0) && req.payer != msg.sender) revert PayerMismatch(req.payer, msg.sender);
        if (_payments[req.paymentId].paidAt != 0) revert AlreadyPaid(req.paymentId);

        address payout = _merchants[req.merchantId].payout;
        if (payout == address(0)) revert UnknownMerchant(req.merchantId);

        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hashPaymentRequest(req), signature);
        if (err != ECDSA.RecoverError.NoError || recovered != signer) revert InvalidSignature();

        fee = (req.amount * feeBps) / BPS_DENOMINATOR;

        _payments[req.paymentId] = Payment({
            payer: msg.sender,
            merchantId: req.merchantId,
            amount: req.amount,
            fee: fee,
            refunded: 0,
            paidAt: uint64(block.timestamp)
        });

        token.safeTransferFrom(msg.sender, payout, req.amount - fee);
        if (fee > 0) token.safeTransferFrom(msg.sender, feeRecipient, fee);

        emit PaymentPaid(req.paymentId, req.merchantId, msg.sender, payout, req.amount, fee);
    }

    // ---------------------------------------------------------------------
    // Merchants
    // ---------------------------------------------------------------------

    /// @notice Register a new merchant and its payout wallet. Called by the Aevify backend.
    function registerMerchant(bytes32 merchantId, address payout) external onlyOperatorOrOwner {
        if (merchantId == bytes32(0)) revert InvalidMerchantId();
        if (payout == address(0)) revert ZeroAddress();
        if (_merchants[merchantId].payout != address(0)) revert MerchantExists(merchantId);

        _merchants[merchantId].payout = payout;
        emit MerchantRegistered(merchantId, payout);
    }

    /// @notice Start a payout wallet change. It can be applied after PAYOUT_CHANGE_DELAY.
    /// @dev Callable by the merchant's current payout wallet, the operator or the owner.
    ///      A new request replaces any pending one and restarts the delay.
    function requestPayoutChange(bytes32 merchantId, address newPayout) external {
        Merchant storage m = _merchants[merchantId];
        if (m.payout == address(0)) revert UnknownMerchant(merchantId);
        if (msg.sender != m.payout && msg.sender != operator && msg.sender != owner()) revert Unauthorized();
        if (newPayout == address(0)) revert ZeroAddress();

        m.pendingPayout = newPayout;
        m.pendingPayoutAt = uint64(block.timestamp) + PAYOUT_CHANGE_DELAY;
        emit PayoutChangeRequested(merchantId, m.payout, newPayout, m.pendingPayoutAt);
    }

    /// @notice Apply a pending payout change once the delay has passed. Anyone can call this.
    function applyPayoutChange(bytes32 merchantId) external {
        Merchant storage m = _merchants[merchantId];
        if (m.pendingPayout == address(0)) revert NoPendingPayoutChange(merchantId);
        if (block.timestamp < m.pendingPayoutAt) revert PayoutChangeNotReady(m.pendingPayoutAt);

        address oldPayout = m.payout;
        m.payout = m.pendingPayout;
        m.pendingPayout = address(0);
        m.pendingPayoutAt = 0;
        emit PayoutChanged(merchantId, oldPayout, m.payout);
    }

    /// @notice Cancel a pending payout change. Callable by the current payout wallet or the owner,
    ///         so a merchant can stop a change made from a hijacked dashboard account.
    function cancelPayoutChange(bytes32 merchantId) external {
        Merchant storage m = _merchants[merchantId];
        if (m.pendingPayout == address(0)) revert NoPendingPayoutChange(merchantId);
        if (msg.sender != m.payout && msg.sender != owner()) revert Unauthorized();

        address cancelled = m.pendingPayout;
        m.pendingPayout = address(0);
        m.pendingPayoutAt = 0;
        emit PayoutChangeCancelled(merchantId, cancelled);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice The EIP-712 digest the backend signs for a payment request.
    function hashPaymentRequest(PaymentRequest calldata req) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PAYMENT_REQUEST_TYPEHASH, req.paymentId, req.merchantId, req.amount, req.expiresAt, req.payer
                )
            )
        );
    }

    /// @notice Fee and merchant payout for an amount at the current fee.
    function quote(uint256 amount) external view returns (uint256 fee, uint256 merchantReceives) {
        fee = (amount * feeBps) / BPS_DENOMINATOR;
        merchantReceives = amount - fee;
    }

    function getMerchant(bytes32 merchantId) external view returns (Merchant memory) {
        return _merchants[merchantId];
    }

    function getPayment(bytes32 paymentId) external view returns (Payment memory) {
        return _payments[paymentId];
    }

    function isPaid(bytes32 paymentId) external view returns (bool) {
        return _payments[paymentId].paidAt != 0;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setFeeBps(uint16 newFeeBps) external onlyOwner {
        _setFeeBps(newFeeBps);
    }

    function setSigner(address newSigner) external onlyOwner {
        _setSigner(newSigner);
    }

    function setOperator(address newOperator) external onlyOwner {
        _setOperator(newOperator);
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        _setFeeRecipient(newRecipient);
    }

    /// @notice Stop new payments. The operator can pause in an emergency; only the owner can unpause.
    function pause() external onlyOperatorOrOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @dev Renouncing would leave the contract without anyone able to unpause or rotate keys.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    function _setFeeBps(uint16 newFeeBps) private {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps, MAX_FEE_BPS);
        emit FeeUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    function _setSigner(address newSigner) private {
        if (newSigner == address(0)) revert ZeroAddress();
        emit SignerUpdated(signer, newSigner);
        signer = newSigner;
    }

    function _setOperator(address newOperator) private {
        if (newOperator == address(0)) revert ZeroAddress();
        emit OperatorUpdated(operator, newOperator);
        operator = newOperator;
    }

    function _setFeeRecipient(address newRecipient) private {
        if (newRecipient == address(0)) revert ZeroAddress();
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }
}
