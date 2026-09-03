import React, { useState, useEffect, useCallback } from "react";
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
  const [tweetLock, setTweetLock] = useState("");
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
    if (walletAddress) {
      setTweetLock(getTweetLock(walletAddress));
    } else {
      setTweetLock("");
    }
  }, [refreshStatus, walletAddress]);

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

  const TWEET_LS_PREFIX = "hf_tweet_lock_";
  const TWEET_WINDOW_MS = 12 * 60 * 60 * 1000; // 12h client-side gate

  function getTweetLock(addr) {
    if (!addr) return "";
    const raw = localStorage.getItem(TWEET_LS_PREFIX + addr.toLowerCase());
    if (!raw) return "";
    const ts = Number(raw);
    const remain = ts + TWEET_WINDOW_MS - Date.now();
    if (remain <= 0) {
      localStorage.removeItem(TWEET_LS_PREFIX + addr.toLowerCase());
      return "";
    }
    return formatTime(Math.floor(remain / 1000));
  }

  async function generateTweet() {
    if (!walletAddress) return;
    const lock = getTweetLock(walletAddress);
    if (lock) {
      toast("Next tweet available in " + lock, "info");
      return;
    }
    setTweetLoading(true);
    try {
      const base = VERIFIER_SERVER.replace(/\/+$/, "");
      const tweetUrl = base ? base + "/tweet" : "/api/tweet";
      const res = await fetch(tweetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress: walletAddress }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Could not generate tweet", "error");
        return;
      }
      const tweet = data.tweet;
      localStorage.setItem(
        TWEET_LS_PREFIX + walletAddress.toLowerCase(),
        String(Date.now())
      );
      setTweetLock(getTweetLock(walletAddress));

      // Copy to clipboard
      try {
        await navigator.clipboard.writeText(tweet);
        toast("Tweet copied — paste it and post it!", "success");
      } catch {
        toast(tweet.replace(/\s+/g, " ").slice(0, 90) + "…", "info");
      }
      window.open(
        "https://twitter.com/intent/tweet?text=" + encodeURIComponent(tweet),
        "_blank"
      );
    } catch (e) {
      toast(e.message || "Something went wrong", "error");
    } finally {
      setTweetLoading(false);
    }
  }

  return (
    <div className="page">
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
                  <strong>@HashCoinFarm #hashcoin</strong>
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

              <button
                className="btn secondary"
                onClick={generateTweet}
                disabled={tweetLoading}
              >
                {tweetLoading
                  ? "Generating..."
                  : tweetLock
                  ? `Tweet again in ${tweetLock}`
                  : "Generate a tweet 🐦"}
              </button>
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