import { createThirdwebClient } from "thirdweb";

// ===== THIRDWEB CLIENT =====
// Client ID from .env (VITE_ prefix makes it available in the browser)
export const client = createThirdwebClient({
  clientId: import.meta.env.VITE_THIRDWEB_CLIENT_ID,
});

// ===== WALLETCONNECT =====
// Global WalletConnect Project ID (needed for third-party wallets)
export const walletConnectProjectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

// ===== FAUCET SETTINGS =====
export const CONTRACT_ADDRESS =
  "0x68B3F95f2ebF0D69F224fc80b1839de02Fabc757";

// On Vercel the backend is a serverless function in the same project (/api/verify).
// When running locally with `npm run dev`, Vite proxies /api to http://localhost:3001.
export const VERIFIER_SERVER = ""; // empty = same origin /api/verify

export const GALXE_QUEST_URL =
  "https://app.galxe.com/quest/bAFdwDecXS6NRWsbYqVAgh/GCTrRtZmii";

// BASE chain id
export const CHAIN_ID = 8453;

// Contract ABI
export const CONTRACT_ABI = [
  "function claimAccess(tuple(address user,uint256 nonce,uint256 expiry) attestation, bytes signature) external",
  "function canClaim(address user) view returns (bool)",
  "function getAccessStatus(address user) view returns (bool hasAccess, uint256 expiry, uint256 timeLeft)",
  "function getTimeUntilNextClaim(address user) view returns (uint256)",
  "function getFaucetBalance() view returns (uint256)",
  "function rewardAmount() view returns (uint256)",
  "function userNonce(address) view returns (uint256)",
  "function claim() external"
];