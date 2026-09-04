import React, { useState, useEffect, useCallback, useRef } from "react";
import { ConnectButton, useActiveAccount } from "thirdweb/react";
import { defineChain } from "thirdweb/chains";
import { ethers } from "ethers";
import { createWallet } from "thirdweb/wallets";

import {
  walletConnectProjectId,
  CONTRACT_ADDRESS,
  VERIFIER_SERVER,
  GALXE_QUEST_URL,
  CHAIN_ID,
  CONTRACT_ABI,
} from "./config";
import EcoGrid from "./EcoGrid";
import { useToast } from "./Toast";
import "./styles.css";

const TWEET_TIPS = [
  "Crafting the perfect words...",
  "AI is thinking about your project...",
  "Mixing hashtags with personality...",
  "Almost ready — polishing the text...",
  "Your tweet is taking shape...",
  "Great tweets take a moment...",
  "Optimizing for 280 characters...",
  "Adding some crypto flair...",
];

// Guaranteed local fallback tweets — used if the server ever returns an error
// or an empty result, so the user ALWAYS gets a usable tweet, no matter what.
const FALLBACK_TWEETS = [
  `Mining Hash: mine $HASH on Base via NFT gear & staking. Join the Galxe quest and earn rewards free. @HashCoinFarm #hashcoin https://app.galxe.com/quest/bAFdwDecXS6NRWsbYqVAgh`,
  `Turn engagement into $HASH. Mining Hash mines on-chain with NFT equipment — no hardware. Complete the @HashCoinFarm quest on Galxe. #hashcoin https://app.galxe.com/quest/bAFdwDecXS6NRWsbYqVAgh`,
  `A full Web3 mining ecosystem on Base. Join Mining Hash, take the Galxe quest and start earning #hashcoin today. @HashCoinFarm https://app.galxe.com/quest/bAFdwDecXS6NRWsbYqVAgh`,
  `Own the machine. @HashCoinFarm #hashcoin — mine $HASH on Base, stake NFTs, vote, launch. Free rewards via the Galxe quest. https://app.galxe.com/quest/bAFdwDecXS6NRWsbYqVAgh`,
];

function pickFallback(address) {
  const h = (address || "0").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return FALLBACK_TWEETS[h % FALLBACK_TWEETS.length];
}

// Wallets available in the Thirdweb connect button
const wallets = [
  createWallet("io.metamask"),
  createWallet("io.rabby"),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow"),
  createWallet("com.trustwallet.app"),
  createWallet("app.phantom"),
];

// Find EIP-1193 provider in the window (Rabby/MetaMask/any)
function getWindowProvider() {
  if (window.ethereum) return window.ethereum;
  return null;
}

export default function Faucet({ client: clientProp }) {
  const account = useActiveAccount();
  const [status, setStatus] = useState(null);
  const [balance, setBalance] = useState("—");
  const [reward, setReward] = useState("—");
  const [nextClaim, setNextClaim] = useState("—");
  const [loading, setLoading] = useState(false);
  const [tweetLoading, setTweetLoading] = useState(false);
  const [generatedTweet, setGeneratedTweet] = useState("");
  const [tweetError, setTweetError] = useState("");
  const [tweetModalOpen, setTweetModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tweetTip, setTweetTip] = useState(TWEET_TIPS[0]);
  const [tweetElapsed, setTweetElapsed] = useState(0);
  const tweetTipIndex = useRef(0);
  const toast = useToast();

  const walletAddress = account?.address;

  // Resolve backend URL: empty = same-origin /api/verify (Vercel), else custom
  const apiBase = VERIFIER_SERVER
    ? VERIFIER_SERVER.replace(/\/+$/, "")
    : "";

  // Get ethers signer via EIP-1193 (window.ethereum)
  async function getSigner() {
    const provider = getWindowProvider();
    if (!provider)
      throw new Error("No wallet found in browser. Install Rabby/MetaMask.");
    const browser = new ethers.BrowserProvider(provider);
    return await browser.getSigner();
  }

  const refreshStatus = useCallback(async () => {
    if (!walletAddress) {
      setStatus(null);
      return;
    }
    try {
      const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
      const contract = new ethers.Contract(
        CONTRACT_ADDRESS,
        CONTRACT_ABI,
        provider
      );
      const [hasAccess, expiry, timeLeft] = await contract.getAccessStatus(
        walletAddress
      );
      const canClaimNow = await contract.canClaim(walletAddress);
      const bal = await contract.getFaucetBalance();
      const rew = await contract.rewardAmount();

      setStatus({
        hasAccess,
        expiry: Number(expiry),
        timeLeft: Number(timeLeft),
        canClaimNow: Boolean(canClaimNow),
      });
      setBalance((Number(BigInt(bal.toString())) / 1e18).toFixed(2) + " HASH");
      setReward((Number(BigInt(rew.toString())) / 1e18).toFixed(2) + " HASH");

      if (canClaimNow) {
        setNextClaim("Ready to claim!");
      } else {
        const t = await contract.getTimeUntilNextClaim(walletAddress);
        setNextClaim(formatTime(Number(t)));
      }
    } catch (e) {
      console.error("refreshStatus", e);
    }
  }, [walletAddress]);

  // Countdown timer
  useEffect(() => {
    if (!status?.hasAccess) return;
    const t = setInterval(() => {
      setStatus(s => ({
        ...s,
        timeLeft: Math.max(0, (s?.timeLeft || 0) - 1),
      }));
    }, 1000);
    return () => clearInterval(t);
  }, [status?.hasAccess]);

  // Refresh status on wallet change
  useEffect(() => {
    refreshStatus();
  }, [refreshStatus, walletAddress]);

  // Tweet generation tip rotation
  useEffect(() => {
    if (!tweetLoading) return;
    const interval = setInterval(() => {
      tweetTipIndex.current = (tweetTipIndex.current + 1) % TWEET_TIPS.length;
      setTweetTip(TWEET_TIPS[tweetTipIndex.current]);
    }, 2500);
    return () => clearInterval(interval);
  }, [tweetLoading]);

  // Tweet elapsed timer
  useEffect(() => {
    if (!tweetLoading) { setTweetElapsed(0); return; }
    const interval = setInterval(() => setTweetElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [tweetLoading]);

  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  }

  function parseReward(r) {
    if (!r || r === "—") return "";
    const n = parseFloat(r);
    return Number.isFinite(n) ? `${n} HASH` : r;
  }

  async function claimAccess() {
    if (!walletAddress) return;
    setLoading(true);
    try {
      const signer = await getSigner();

      // Get user nonce
      const contractRead = new ethers.Contract(
        CONTRACT_ADDRESS,
        CONTRACT_ABI,
        signer.provider
      );
      const nonce = Number(await contractRead.userNonce(walletAddress));

      const base = VERIFIER_SERVER.replace(/\/+$/, "");
      // When VERIFIER_SERVER is empty, the backend lives at /api/verify
      // on the same origin (Vercel serverless function).
      const verifyUrl = base ? base + "/verify" : "/api/verify";
      const res = await fetch(verifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: walletAddress,
          nonce,
          verifyingContract: CONTRACT_ADDRESS,
          chainId: CHAIN_ID,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast(err.error || "Not eligible yet", "error");
        window.open(GALXE_QUEST_URL, "_blank");
        return;
      }

      const data = await res.json();
      const contract = new ethers.Contract(
        CONTRACT_ADDRESS,
        CONTRACT_ABI,
        signer
      );
      const tx = await contract.claimAccess(data.attestation, data.signature);
      await tx.wait();

      toast("Access granted! 7 days active.", "success");
      refreshStatus();
    } catch (e) {
      toast(e.reason || e.message || "Something went wrong", "error");
    } finally {
      setLoading(false);
    }
  }

  async function claimTokens() {
    if (!walletAddress) return;
    setLoading(true);
    try {
      const signer = await getSigner();
      const contract = new ethers.Contract(
        CONTRACT_ADDRESS,
        CONTRACT_ABI,
        signer
      );
      const tx = await contract.claim();
      await tx.wait();
      toast("Tokens claimed!", "success");
      refreshStatus();
    } catch (e) {
      toast(e.reason || e.message || "Something went wrong", "error");
    } finally {
      setLoading(false);
    }
  }

  async function generateTweet() {
    if (tweetLoading) return;
    setTweetLoading(true);
    setTweetError("");
    setCopied(false);
    setTweetElapsed(0);
    setTweetModalOpen(true);

    let returnedTweet = "";

    try {
      const base = VERIFIER_SERVER.replace(/\/+$/, "");
      const tweetUrl = base ? base + "/tweet" : "/api/tweet";

      // Hard-fail after 20s so the overlay never hangs forever. The server
      // falls back to templates in ~5s, so this is just a safety net.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      let res;
      try {
        res = await fetch(tweetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            userAddress: walletAddress || "0x0000000000000000000000000000000000000000",
          }),
        });
      } finally {
        clearTimeout(timeout);
      }

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.tweet) {
        returnedTweet = String(data.tweet).trim();
      } else {
        setTweetError(data.error || "The server could not generate a tweet.");
      }
    } catch (e) {
      if (e.name === "AbortError") {
        setTweetError("Timed out — the server took too long.");
      } else {
        setTweetError(e.message || "Could not reach the server.");
      }
    }

    // Guarantee a result: if the server failed or returned empty, use a local
    // template. The user ALWAYS gets a usable tweet to copy or publish.
    if (!returnedTweet) {
      setTweetError((prev) => (prev ? prev + " Using a fallback tweet instead." : "Using a fallback tweet."));
      returnedTweet = pickFallback(walletAddress);
    }

    setGeneratedTweet(returnedTweet);
    setTweetLoading(false);
  }

  async function copyTweet() {
    if (!generatedTweet) return;
    try {
      await navigator.clipboard.writeText(generatedTweet);
      setCopied(true);
      toast("Tweet copied to clipboard!", "success");
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      toast(generatedTweet.replace(/\s+/g, " ").slice(0, 90) + "…", "info");
    }
  }

  function closeTweetModal() {
    if (tweetLoading) return;
    setTweetModalOpen(false);
    setGeneratedTweet("");
    setTweetError("");
  }

  async function publishTweet() {
    if (!generatedTweet) return;
    window.open(
      "https://twitter.com/intent/tweet?text=" + encodeURIComponent(generatedTweet),
      "_blank",
      "noopener,noreferrer"
    );
  }

  return (
    <div className="page">
      {/* Tweet modal — stays open until the user closes it (X) */}
      {tweetModalOpen && (
        <div className="tweet-overlay" onClick={closeTweetModal}>
          <div
            className="tweet-overlay-card"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button (disabled while generating) */}
            <button
              className="tweet-modal-close"
              onClick={closeTweetModal}
              disabled={tweetLoading}
              title="Close"
            >
              ×
            </button>

            {tweetLoading ? (
              <div className="tweet-overlay-body">
                <div className="tweet-overlay-bar">
                  <div className="tweet-overlay-bar-fill" />
                </div>
                <div className="tweet-overlay-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
                  </svg>
                </div>
                <div className="tweet-overlay-label">Generating Tweet</div>
                <div className="tweet-overlay-sub">AI is crafting your message</div>
                <div className="tweet-overlay-tip">{tweetTip}</div>
                <div className="tweet-overlay-timer">{tweetElapsed}s elapsed</div>
              </div>
            ) : (
              <div className="tweet-overlay-body">
                <div className="tweet-overlay-bar">
                  <div className="tweet-overlay-bar-fill done" />
                </div>

                <div className="tweet-modal-head">
                  <span className="tweet-modal-title">Your tweet</span>
                  <span
                    className={
                      generatedTweet && generatedTweet.length > 280
                        ? "char-count over"
                        : "char-count"
                    }
                  >
                    {generatedTweet ? generatedTweet.length + "/280" : ""}
                  </span>
                </div>

                {tweetError && (
                  <div className="tweet-modal-note">
                    <span className="tweet-modal-note-dot" />
                    {tweetError}
                  </div>
                )}

                <div className="tweet-preview-text">{generatedTweet}</div>

                <div className="tweet-preview-actions">
                  <button
                    className={`btn secondary${copied ? " copied" : ""}`}
                    onClick={copyTweet}
                  >
                    {copied ? "Copied!" : "Copy tweet"}
                  </button>
                  <button className="btn primary" onClick={publishTweet}>
                    Publish on X
                  </button>
                </div>

                <button
                  className="regenerate"
                  onClick={generateTweet}
                  disabled={tweetLoading}
                >
                  Regenerate
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="container">
        <div className="card">
          <header>
            <div className="logo">
              <img src="/logo.webp" alt="Mining Hash" />
            </div>
            <h1>Hash Faucet</h1>
            <p>7 days access — Claim {parseReward(reward)} for every tweet about the project</p>
          </header>

          <div className="connect">
            <ConnectButton
              client={clientProp}
              chain={defineChain(CHAIN_ID)}
              wallets={wallets}
              connectModal={{
                size: "compact",
                title: "Connect Wallet",
                showAllWallets: true,
                walletConnect: { projectId: walletConnectProjectId },
              }}
            />
          </div>

          <div className="info-card">
            <div className="row">
              <span>Status</span>
              <b className={status?.hasAccess ? "status-on" : "status-off"}>
                {status?.hasAccess ? "Active" : "Inactive"}
                {status?.hasAccess && status?.timeLeft > 0 && (
                  <span className="timer">{formatTime(status.timeLeft)}</span>
                )}
              </b>
            </div>
            <Row label="Faucet balance" value={balance} />
          </div>

          {!status?.hasAccess && (
            <div className="steps">
              <h3>Get 7 days of faucet access</h3>
              <ol>
                <li>
                  Tweet about the project with{" "}
                  <strong>@HashCoinFarm #hashcoin</strong>{" "}
                  <a className="link-inline" onClick={generateTweet} href="#">
                    generate
                  </a>
                </li>
                <li>
                  Complete the quest on <strong>Galxe</strong> →{" "}
                  <a href={GALXE_QUEST_URL} target="_blank" rel="noreferrer">
                    open quest
                  </a>
                </li>
                <li>Connect your wallet here, then sign below</li>
              </ol>
              <p className="hint">
                Eligible once → <strong>7 days</strong> of access, claim up to{" "}
                <strong>20 HASH</strong> daily.
              </p>
            </div>
          )}

          <div className="tweet-section">
            <div className="tweet-section-head">
              <h3>Tweet about the project</h3>
              <span className="tweet-tags">@HashCoinFarm #hashcoin</span>
            </div>
            <button
              className="btn primary"
              onClick={generateTweet}
              disabled={tweetLoading}
            >
              Generate a tweet
            </button>
          </div>

          {walletAddress && (
            <div className="actions">
              {!status?.hasAccess ? (
                <>
                  <button
                    className="btn primary"
                    onClick={claimAccess}
                    disabled={loading}
                  >
                    {loading
                      ? "Checking..."
                      : "Verify quest → Get 7 days"}
                  </button>
                  <a
                    className="btn link"
                    href={GALXE_QUEST_URL}
                    target="_blank"
                    rel="noopener"
                  >
                    Jump to quest →
                  </a>
                </>
              ) : (
                <button
                  className="btn primary"
                  onClick={claimTokens}
                  disabled={loading || !status?.canClaimNow}
                >
                  {loading
                    ? "Processing..."
                    : status?.canClaimNow
                    ? `Claim ${parseReward(reward)}`
                    : `Claim ${parseReward(reward)} in ${nextClaim}`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="container">
        <EcoGrid />
      </div>

      <footer>
        <div className="footer-inner">
          <span>Mining Hash — engaging with rewards.</span>
          <span>Leave your mark in the machine.</span>
        </div>
      </footer>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}