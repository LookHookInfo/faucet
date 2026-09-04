/**
 * Serverless tweet generator for the Hash Faucet — Vercel Function.
 *
 * Generates a unique, content-rich promotional tweet about the Mining Hash
 * ecosystem. Every tweet is forced to fit Twitter's character limit and always
 * includes:
 *   - the mandatory handle      @HashCoinFarm
 *   - the main hashtag          #hashcoin (plus a couple of relevant ones)
 *   - the Galxe quest link       https://app.galxe.com/quest/bAFdwDecXS6NRWsbYqVAgh
 *   - the faucet link            https://faucet.lookhook.info
 *
 * Deployed as: /api/tweet
 * Local dev:   node api/tweet.js  (Express fallback on port 3002)
 *
 * Required env:
 *   ANYMODEL_API_KEY           — key for the AI generator (Anymodel / OpenAI-compatible)
 *
 * Optional env:
 *   ANYMODEL_URL               — AI base chat/completions endpoint
 *   ANYMODEL_MODEL             — model id (default ag/gemini-2.5-flash)
 *   AI_TIMEOUT_MS              — how long to wait for the AI before falling back (default 5s)
 *   TWEET_MAX_LEN              — hard character limit for the final tweet (default 270)
 */

// Cap how long this function may run. Vercel Hobby defaults to 10s for this
// framework; keep well under so a slow AI call always returns something fast
// (we fall back to curated templates rather than time out at the edge).
export const config = { maxDuration: 30 };

const AI_KEY = process.env.ANYMODEL_API_KEY;
const AI_URL =
  process.env.ANYMODEL_URL || "https://anymodel.org/v1/chat/completions";
const AI_MODEL = process.env.ANYMODEL_MODEL || "ag/gemini-2.5-flash";
const FAUCET_URL = process.env.FAUCET_URL || "https://faucet.lookhook.info";
const GALXE_URL =
  process.env.GALXE_QUEST_URL ||
  "https://app.galxe.com/quest/bAFdwDecXS6NRWsbYqVAgh";
const TWEET_MAX_LEN = Number(process.env.TWEET_MAX_LEN || 270);
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 5000);

const MANDATORY_HANDLE = "@HashCoinFarm";
const MANDATORY_HASHTAG = "#hashcoin";

// ===== Project knowledge fed to the model (from the Mining Hash article) =====
const PROJECT_KNOWLEDGE = `
Mining Hash is a Web3 mining ecosystem built on the Base network by the LookHook team.
- HASH is the native utility token (max supply 10B), contract ownership is renounced (fully decentralized).
- Mining is fully on-chain: users mine HASH through NFT mining equipment and staking — no energy-hungry hardware, permissionless for anyone with a Web3 wallet.
- Tokenomics: 80% goes to mining rewards, 10% strategic partners, 10% marketing/community quests & airdrops.
- Ecosystem products: GemFun (launchpad on a bonding curve, trades in HASH, liquidity auto-migrated to Uniswap at TGE), De-Vote (DAO governance with guaranteed rewards to voters), .hash Name Service (forever on-chain, buy once own for life), Plasma Cat NFT collection, Lock Staking (9% APR), Pager (AI SocialFi content tool).
- An extensive quest campaign with reward-bearing tasks is live on Galxe — zero initial investment, anyone can accumulate HASH through engagement.
`;

// ===== Local template fallback (used when the AI key is missing or fails) =====
const TEMPLATES = [
  `Mining Hash: mine HASH on Base via NFTs & staking. Join the Galxe quest and earn rewards free. @HashCoinFarm #hashcoin ${GALXE_URL}`,
  `Turn engagement into HASH. Mining Hash mines on-chain with NFT gear — no hardware. Complete the @HashCoinFarm quest on Galxe. #hashcoin ${GALXE_URL}`,
  `A full Web3 mining ecosystem on Base 🚀 Join Mining Hash, take part in the Galxe quest and start earning HASH today. @HashCoinFarm #hashcoin ${GALXE_URL}`,
  `Own the machine. @HashCoinFarm #hashcoin — mine HASH on Base, stake NFTs, vote, launch. Free rewards via the Galxe guest quest. ${GALXE_URL}`,
  `Web3 mining, reimagined ⛏️ Mining Hash: on-chain NFT mining, DAO, launchpad & AI. Complete the quest on Galxe for free HASH. @HashCoinFarm #hashcoin ${GALXE_URL}`,
  `Mining Hash — engaging with rewards. Mine HASH on Base, unlock quest rewards on Galxe and grow with the community. #hashcoin @HashCoinFarm ${GALXE_URL}`,
];

// Deterministic pseudo-random tweak so references "unique" tweets differ a bit.
function stableHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// ===== Character budget =====
// Build a tweet that fits under TWEET_MAX_LEN by trimming from the tail
// at a word boundary (keeps the mandatory tags + links intact).
function fitTweet(text, hardLimit) {
  let clean = (text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= hardLimit) return clean;

  // Cut to a whole-word prefix, leaving room for nothing (no suffixes needed —
  // mandatory tags/links are appended below if missing, but they are usually
  // already present, so we trim to the hard limit directly).
  let cut = clean.slice(0, hardLimit);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > hardLimit * 0.6) cut = cut.slice(0, lastSpace);
  return cut.replace(/[.,;:!? ]+$/, "").trim();
}

// Ensure every tweet carries the handle, the core hashtag and both links.
// Also strip any "$HASH"-style ticker references — "$" implies a market ticker
// that points at a different project's token, so we only ever use the plain
// "HASH" name.
function finalizeTweet(text) {
  let out = (text || "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .replace(/\$HASH\b/gi, "HASH")
    .trim();
  out = fitTweet(out, TWEET_MAX_LEN);
  if (!out.includes(MANDATORY_HANDLE)) out += ` ${MANDATORY_HANDLE}`;
  if (!out.includes(MANDATORY_HASHTAG)) out += ` ${MANDATORY_HASHTAG}`;
  if (!out.includes(GALXE_URL)) out += ` Join the quest: ${GALXE_URL}`;
  if (!out.includes(FAUCET_URL)) out += ` ${FAUCET_URL}`;
  return fitTweet(out.trim(), TWEET_MAX_LEN);
}

// ===== AI generation =====
async function generateWithAI(address) {
  if (!AI_KEY) {
    return null; // no key -> fall back to templates
  }

  const userHint = `${address.slice(0, 6)}...${address.slice(-4)}`;

  const system = [
    "You are a marketing copywriter for Mining Hash, a Web3 mining ecosystem on the Base network.",
    "Write ONE short promotional Tweet (well under 280 characters).",
    "Structure it as: a short bold hook/headline, then a one-line mini description from the ecosystem facts, then a clear call-to-action to join the Galxe quest.",
    `You MUST include the exact handle "${MANDATORY_HANDLE}" and hashtag "${MANDATORY_HASHTAG}" with no extra spaces.`,
    "NEVER write the token with a dollar sign (no $HASH, no $hash). Always write the plain name as HASH or \"the HASH token\".",
    "Add 1-2 relevant extra hashtags (e.g. #Web3 #Base #Mining #DeFi).",
    `Always reference the Galxe quest link: ${GALXE_URL}.`,
    `Rarely reference the faucet link: ${FAUCET_URL}, when it fits naturally.`,
    "Keep it natural, friendly and crypto-enthusiastic. 1-2 emojis max.",
    "Never invent links, addresses or token numbers not given here.",
    "Plain text only: NO markdown, no asterisks, no asterisk-bold, no quotes around text.",
    "Output ONLY the tweet text, no quotes, no commentary.",
    `Budget check: the final text (with tags + link) must be under ${TWEET_MAX_LEN} characters.`,
  ].join("\n");

  const user = `Ecosystem facts:\n${PROJECT_KNOWLEDGE}\n\nTweak (personalisation seed): user ${userHint}. Generate the tweet now.`;

  const body = JSON.stringify({
    model: AI_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.8,
    max_tokens: 140,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const resp = await fetch(AI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_KEY}`,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      console.error("AI generate HTTP", resp.status);
      return null;
    }
    const raw = await resp.text();
    if (!raw) return null;
    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseErr) {
      console.error("AI generate non-JSON response", parseErr.message, raw.slice(0, 200));
      return null;
    }
    const text = data?.choices?.[0]?.message?.content || "";
    if (!text) return null;
    return finalizeTweet(text);
  } catch (e) {
    clearTimeout(timer);
    console.error("AI generate error", e.message);
    return null;
  }
}

function pickTemplate(address) {
  const idx = stableHash(address) % TEMPLATES.length;
  return TEMPLATES[idx];
}

// ===== Shared request handler =====
async function handle(reqBody) {
  const { userAddress } = reqBody || {};
  if (!userAddress) {
    return { status: 400, body: { error: "userAddress required" } };
  }
  const addr = userAddress.toLowerCase();

  const aiTweet = await generateWithAI(addr);
  const tweet = aiTweet || finalizeTweet(pickTemplate(addr));

  return {
    status: 200,
    body: { tweet, generatedBy: aiTweet ? "ai" : "template" },
  };
}

// ===== Vercel serverless entry =====
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  // Vercel body may arrive as a raw JSON string — normalise it.
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

// ===== Local dev fallback (node api/tweet.js) =====
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("api/tweet.js") ||
    process.argv[1].endsWith("api\\tweet.js"));

if (isDirectRun) {
  const dotenv = (await import("dotenv")).default;
  dotenv.config();
  const express = (await import("express")).default;
  const cors = (await import("cors")).default;
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.post("/api/tweet", async (req, res) => {
    try {
      const result = await handle(req.body || {});
      res.status(result.status).json(result.body);
    } catch (e) {
      res.status(500).json({ error: `Internal error: ${e.message}` });
    }
  });
  app.get("/health", (req, res) =>
    res.json({ status: "ok", endpoint: "/api/tweet" })
  );
  const PORT = process.env.PORT || 3002;
  app.listen(PORT, () =>
    console.log(`🚀 Local tweet generator on http://localhost:${PORT}/api/tweet`)
  );
}
