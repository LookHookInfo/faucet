/**
 * Serverless verifier for the Hash Faucet — Vercel Function.
 *
 * 1. Checks Galxe eligibility for the user address.
 * 2. If eligible, signs an EIP-712 Attestation with the verifier's
 *    private key (stored in Vercel Environment Variables, never in git).
 *
 * Deployed as: /api/verify
 * Local dev:   node api/verify.js  (Express fallback on port 3001)
 *
 * Required env:
 *   VERIFIER_PRIVATE_KEY
 *   GALXE_API_TOKEN
 *   GALXE_QUEST_ID
 *   CONTRACT_ADDRESS  (optional fallback)
 */

import { ethers } from "ethers";

const QUEST_ID = process.env.GALXE_QUEST_ID || "GCTrRtZmii";
const GALXE_API_URL = "https://graphigo-business.prd.galaxy.eco/query";

// ===== EIP-712 =====
const EIP712_DOMAIN_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
};

const ATTESTATION_TYPES = {
  Attestation: [
    { name: "user", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
};

// ===== Galxe eligibility =====
async function checkGalxeEligibility(userAddress) {
  const query = `
    query CheckEligibility($questId: ID!, $address: String!) {
      quest(id: $questId) {
        id
        name
        status
        credentialGroups(address: $address) {
          id
          name
          conditionRelation
          conditions {
            expression
            eligible
          }
        }
      }
    }
  `;

  const response = await fetch(GALXE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "access-token": process.env.GALXE_API_TOKEN,
    },
    body: JSON.stringify({
      query,
      variables: { questId: QUEST_ID, address: userAddress.toLowerCase() },
    }),
  });

  if (!response.ok) {
    return { eligible: false, error: `Galxe API error ${response.status}` };
  }

  const data = await response.json();
  const quest = data?.data?.quest;

  if (!quest) {
    return { eligible: false, error: "Quest not found" };
  }

  const ACTIVE_STATUSES = ["ACTIVE", "LIVE", "Active", "Live"];
  if (!ACTIVE_STATUSES.includes(quest.status)) {
    return { eligible: false, error: `Quest not active (${quest.status})` };
  }

  const groups = quest.credentialGroups || [];
  if (groups.length === 0) {
    return { eligible: false, error: "No credential groups" };
  }

  for (const group of groups) {
    const conditions = group.conditions || [];
    if (conditions.length === 0) continue;
    const eligibleConditions = conditions.filter(c => c.eligible);
    if (group.conditionRelation === "ALL") {
      if (eligibleConditions.length !== conditions.length) {
        return { eligible: false, questName: quest.name };
      }
    } else if (group.conditionRelation === "ANY") {
      if (eligibleConditions.length === 0) {
        return { eligible: false, questName: quest.name };
      }
    }
  }

  return { eligible: true, questName: quest.name };
}

// ===== Sign attestation =====
function signAttestation(userAddress, nonce, verifyingContract, chainId) {
  const verifier = new ethers.Wallet(process.env.VERIFIER_PRIVATE_KEY);
  const expiry = Math.floor(Date.now() / 1000) + 3600 * 24 * 7; // 7 days

  const attestation = { user: userAddress, nonce, expiry };
  const domain = {
    name: "HashFaucetV4",
    version: "1",
    chainId,
    verifyingContract,
  };

  return verifier
    .signTypedData(domain, ATTESTATION_TYPES, attestation)
    .then(signature => ({ attestation, signature }));
}

// ===== Shared request handler =====
async function handle(reqBody) {
  const { userAddress, nonce, verifyingContract, chainId } = reqBody;

  if (!userAddress) {
    return { status: 400, body: { error: "userAddress required" } };
  }
  if (!verifyingContract) {
    return { status: 400, body: { error: "verifyingContract required" } };
  }

  let addr;
  try {
    addr = ethers.getAddress(userAddress);
  } catch {
    return { status: 400, body: { error: "Invalid address" } };
  }

  // 1. Check Galxe
  const result = await checkGalxeEligibility(addr);
  if (!result.eligible) {
    return {
      status: 403,
      body: { eligible: false, error: result.error || "Address not eligible" },
    };
  }

  // 2. Sign attestation
  try {
    const signatureResult = await signAttestation(
      addr,
      nonce || 0,
      verifyingContract,
      chainId || 8453
    );
    return { status: 200, body: { eligible: true, ...signatureResult } };
  } catch (error) {
    return { status: 500, body: { error: `Sign failed: ${error.message}` } };
  }
}

// ===== Vercel serverless entry =====
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (err) {
      body = {};
    }
  }
  try {
    const result = await handle(body || {});
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("Unhandled error:", error);
    return res.status(500).json({ error: `Internal error: ${error.message}` });
  }
}

// ===== Local dev fallback (node api/verify.js) =====
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("api/verify.js") ||
    process.argv[1].endsWith("api\\verify.js"));

if (isDirectRun) {
  const dotenv = (await import("dotenv")).default;
  dotenv.config();
  const express = (await import("express")).default;
  const cors = (await import("cors")).default;
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api/verify", async (req, res) => {
    try {
      const result = await handle(req.body || {});
      res.status(result.status).json(result.body);
    } catch (e) {
      res.status(500).json({ error: `Internal error: ${e.message}` });
    }
  });
  app.get("/health", (req, res) =>
    res.json({ status: "ok", endpoint: "/api/verify" })
  );
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () =>
    console.log(`🚀 Local verifier on http://localhost:${PORT}/api/verify`)
  );
}