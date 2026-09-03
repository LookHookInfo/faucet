// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/**
 * @title HashFaucetV4 - Autonomous faucet with Galxe verification
 * @dev Default reward: 20 HASH. Owner can change via setRewardAmount.
 * @dev Verification via EIP-712 signatures from a trusted verifier (frontend)
 * @dev Cost for users: L2 gas only
 */
contract HashFaucetV4 {

    // ============ TYPES ============
    struct Attestation {
        address user;
        uint256 nonce;
        uint256 expiry;
    }

    // ============ CONSTANTS ============
    IERC20 public hashToken;
    uint256 public constant ACCESS_DURATION = 7 days;
    uint256 public constant COOLDOWN = 24 hours;
    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(address user,uint256 nonce,uint256 expiry)"
    );

    // ============ STORAGE ============
    address public owner;
    address public verifier;
    uint256 public rewardAmount;
    uint256 public nonce;

    mapping(address => bool) public hasAccess;
    mapping(address => uint256) public accessExpiry;
    mapping(address => uint256) public lastClaimTime;
    mapping(address => uint256) public userNonce;
    mapping(bytes32 => bool) public usedAttestations;

    // ============ EVENTS ============
    event AccessGranted(address indexed user, uint256 expiry);
    event Claimed(address indexed user, uint256 amount);
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);
    event FaucetRefilled(address indexed from, uint256 amount);
    event RewardUpdated(uint256 oldAmount, uint256 newAmount);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    // ============ MODIFIERS ============
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyWithAccess() {
        require(hasAccess[msg.sender], "No access");
        require(block.timestamp < accessExpiry[msg.sender], "Access expired");
        _;
    }

    // ============ CONSTRUCTOR ============
    constructor() {
        owner = msg.sender;
        // HASH token hardcoded (Base)
        hashToken = IERC20(0xA9B631ABcc4fd0bc766d7C0C8fCbf866e2bB0445);
        // Verifier hardcoded (Base)
        verifier = 0x1d0055e0e829aa6c8f4f5Da92cd449305B68dA73;
        // Default reward: 20 HASH (owner can change)
        rewardAmount = 20 * 10**18;
    }

    // ============ CORE FUNCTIONS ============

    /**
     * @dev Grant access via EIP-712 signature from the verifier
     * @param attestation Attestation data
     * @param signature Verifier signature
     */
    function claimAccess(Attestation calldata attestation, bytes calldata signature) external {
        require(attestation.user == msg.sender, "Attestation not for you");
        require(block.timestamp < attestation.expiry, "Attestation expired");
        require(!hasAccess[msg.sender], "Already have access");

        bytes32 digest = _hashTypedData(attestation);
        require(!usedAttestations[digest], "Attestation already used");
        require(_recoverSigner(digest, signature) == verifier, "Invalid signature");

        usedAttestations[digest] = true;
        hasAccess[msg.sender] = true;
        accessExpiry[msg.sender] = block.timestamp + ACCESS_DURATION;

        emit AccessGranted(msg.sender, accessExpiry[msg.sender]);
    }

    /**
     * @dev Claim tokens (requires access)
     */
    function claim() external onlyWithAccess {
        require(
            block.timestamp >= lastClaimTime[msg.sender] + COOLDOWN,
            "Wait 24h between claims"
        );
        require(
            hashToken.balanceOf(address(this)) >= rewardAmount,
            "Faucet empty"
        );

        lastClaimTime[msg.sender] = block.timestamp;
        require(hashToken.transfer(msg.sender, rewardAmount), "Transfer failed");

        emit Claimed(msg.sender, rewardAmount);
    }

    /**
     * @dev Check if a user can claim
     */
    function canClaim(address user) external view returns (bool) {
        return hasAccess[user] &&
               block.timestamp < accessExpiry[user] &&
               block.timestamp >= lastClaimTime[user] + COOLDOWN;
    }

    /**
     * @dev Time until the next claim
     */
    function getTimeUntilNextClaim(address user) external view returns (uint256) {
        uint256 nextClaim = lastClaimTime[user] + COOLDOWN;
        if (block.timestamp >= nextClaim) return 0;
        return nextClaim - block.timestamp;
    }

    // ============ ADMIN FUNCTIONS ============

    function setVerifier(address newVerifier) external onlyOwner {
        require(newVerifier != address(0), "Invalid address");
        emit VerifierUpdated(verifier, newVerifier);
        verifier = newVerifier;
    }

    /**
     * @dev Owner can change the reward amount (higher or lower)
     */
    function setRewardAmount(uint256 newAmount) external onlyOwner {
        require(newAmount > 0, "Reward must be > 0");
        uint256 oldAmount = rewardAmount;
        rewardAmount = newAmount;
        emit RewardUpdated(oldAmount, newAmount);
    }

    function refill() external payable onlyOwner {
        // For ERC-20 you must approve + transferFrom externally
    }

    function withdraw(uint256 amount) external onlyOwner {
        require(hashToken.transfer(owner, amount), "Transfer failed");
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ============ VIEW FUNCTIONS ============

    function getFaucetBalance() external view returns (uint256) {
        return hashToken.balanceOf(address(this));
    }

    function getAccessStatus(address user) external view returns (
        bool hasAccessStatus,
        uint256 expiry,
        uint256 timeLeft
    ) {
        hasAccessStatus = hasAccess[user];
        expiry = accessExpiry[user];
        if (block.timestamp >= expiry) {
            timeLeft = 0;
        } else {
            timeLeft = expiry - block.timestamp;
        }
    }

    // ============ INTERNAL FUNCTIONS ============

    function _hashTypedData(Attestation calldata attestation) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ATTESTATION_TYPEHASH,
                attestation.user,
                attestation.nonce,
                attestation.expiry
            )
        );
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainSeparator(),
                structHash
            )
        );
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256("HashFaucetV4"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature)
        internal
        pure
        returns (address)
    {
        require(signature.length == 65, "Invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        require(v == 27 || v == 28, "Invalid v");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "Invalid signature");
        return signer;
    }
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}