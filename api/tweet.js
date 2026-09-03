/**
 * Serverless tweet generator for the Hash Faucet — Vercel Function.
 *
 * Generates a unique promotional tweet about Mining Hash / Hash Faucet
 * that always includes the mandatory @HashCoinFarm handle and the
 * #hashcoin hashtag, plus a link to the faucet.
 *
 * Deployed as: /api/tweet
 * Local dev:   node api/tweet.js  (Express fallback on port 3002)
 *
 * Required env:
 *   ANYMODEL_API_KEY           — key for the AI generator (Anymodel / OpenAI-compatible)
 *   TWITTER_RATE_LIMIT_REQ     — max generations per window (default 1)
 *   TWITTER_RATE_WINDOW_MS     — window length (default 12h in ms)
 */

const AI_KEY = process.env.ANYMODEL_API_KEY;
const AI_URL = "https://api.anymodel.org/v1/chat/completions";
const AI_MODEL = process.env.ANYMODEL_MODEL || "ag/gemini-2.5-flash";
const FAUCET_URL = process.env.FAUCET_URL || "https://faucet.lookhook.info";

const MANDATORY_TAGS = "@HashCoinFarm #hashcoin";

// In-memory rate limit keyed by lowercase address + IP.
// NOTE: Vercel functions are ephemeral; this is a soft extra guard on top of
// the client-side localStorage gate. It resets on function re-spin.
const hits = new Map();
const RATE_LIMIT_REQ = Number(
  process.env.TWITTER_RATE_LIMIT_REQ || 1
);
const RATE_WINDOW_MS = Number(
  process.env.TWITTER_RATE_WINDOW_MS || 12 * 60 * 60 * 1000 // 12 hours
);

// Deterministic pseudo-random tweak so two "unique" tweets differ a bit.
function stableHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// Local template library — used as a fallback when the AI key is missing
// or the AI call fails, so the feature still works and never drains tokens.
const TEMPLATES = [
  `Free $HASH every day! Complete the @HashCoinFarm #hashcoin quest and claim 20 $HASH daily on the Mining Hash faucet 👉 ${FAUCET_URL}`,
  `Build the future of mining. Join @HashCoinFarm #hashcoin — verify a tweet, get 7 days of faucet access and claim free $HASH ${FAUCET_URL}`,
  `Mining Hash gives back to its community 🚀 Tweet about the project, unlock the faucet and claim $HASH daily. @HashCoinFarm #hashcoin ${FAUCET_URL}`,
  `Your daily $HASH is waiting 💎 Complete the @HashCoinFarm #hashcoin quest on Mining Hash and start claiming rewards today ${FAUCET_URL}`,
  `Turn a single tweet into 7 days of rewards ⛏️ Claim free $HASH every 24h on the Mining Hash faucet. @HashCoinFarm #hashcoin ${FAUCET_URL}`,
  `Mining Hash — engaging with rewards. Tweet, unlock, and earn $HASH daily. @HashCoinFarm #hashcoin ${FAUCET_URL}`,
];

// ===== AI generation =====
async function generateWithAI(address) {
  if (!AI_KEY) {
    return null; // no key -> fall back to templates
  }

  const userHint = `user address ${address.slice(0, 6)}...${address.slice(-4)}`;
  const prompt = `Write a short, natural promotional tweet (max 100 words) about the Mining Hash project and its Hash Faucet. It must include the exact handle "@HashCoinFarm" and hashtag "#hashcoin" without any extra spaces. Mention that users can claim 20 $HASH daily after tweeting about the project. Reference the faucet link: ${FAUCET_URL}. Use a friendly, crypto-enthusiastic tone. Include an emoji or two. Output only the tweet text, no quotation marks. Tweak: ${userHint}.`;

  const body = JSON.stringify({
    model: AI_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a marketing copywriter for the Mining Hash Web3 project. Always keep @HashCoinFarm and #hashcoin exactly as provided. Never invent links.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.9,
    max_tokens: 160,
  });

  try {
    const resp = await fetch(AI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_KEY}`,
      },
      body,
    });
    if (!resp.ok) {
      console.error("AI generate HTTP", resp.status);
      return null;
    }
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content || "";
    if (!text) return null;

    // Ensure mandatory tags are present; if the model changed the casing,
    // re-append the canonical ones.
    let tweet = text.trim();
    if (!/@HashCoinFarm/.test(tweet)) tweet = `${tweet} @HashCoinFarm`;
    if (!/#hashcoin/.test(tweet)) tweet = `${tweet} #hashcoin`;
    return tweet;
  } catch (e) {
    console.error("AI generate error", e.message);
    return null;
  }
}

function pickTemplate(address) {
  const idx = stableHash(address) % TEMPLATES.length;
  return TEMPLATES[idx];
}

// ===== Rate limiting =====
function allow(key) {
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || now - rec.ts > RATE_WINDOW_MS) {
    hits.set(key, { count: 1, ts: now });
    return true;
  }
  if (rec.count < RATE_LIMIT_REQ) {
    rec.count += 1;
    return true;
  }
  return false;
}

// ===== Shared request handler =====
async function handle(reqBody, ip) {
  const { userAddress } = reqBody || {};
  if (!userAddress) {
    return { status: 400, body: { error: "userAddress required" } };
  }
  const addr = userAddress.toLowerCase();

  const key = addr + "|" + (ip || "");
  if (!allow(key)) {
    const hoursLeft = 12;
    return {
      status: 429,
      body: { error: `Cooldown — try again in ~${hoursLeft}h` },
    };
  }

  const aiTweet = await generateWithAI(addr);
  const tweet = aiTweet || pickTemplate(addr);

  // Amplify: ensure mandatory tags and link are in the final string.
  let finalTweet = tweet;
  if (!finalTweet.includes("@HashCoinFarm")) {
    finalTweet += " @HashCoinFarm";
  }
  if (!finalTweet.includes("#hashcoin")) {
    finalTweet += " #hashcoin";
  }
  if (!finalTweet.includes(FAUCET_URL)) {
    finalTweet += ` ${FAUCET_URL}`;
  }
  finalTweet = finalTweet.trim();

  return { status: 200, body: { tweet: finalTweet, generatedBy: aiTweet ? "ai" : "template" } };
}

// ===== Vercel serverless entry =====
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const ip =
    req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "";
  try {
    const result = await handle(req.body || {}, ip);
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
      const ip = req.ip || "";
      const result = await handle(req.body || {}, ip);
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