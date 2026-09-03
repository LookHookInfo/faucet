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

      setStatus({ hasAccess, expiry: Number(expiry), timeLeft: Number(timeLeft) });
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
  }, [refreshStatus]);

  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  }

  async function callVerify() {
    const url =
      VERIFIER_SERVER.replace(/\/+$/, "") + "/verify" || "/api/verify";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userAddress: walletAddress,
        verifyingContract: CONTRACT_ADDRESS,
        chainId: CHAIN_ID,
      }),
    });
    return res;
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
      const res = await fetch((base || "") + "/verify", {
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
        alert("Galxe: " + (err.error || "not eligible"));
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

      alert("Access granted!");
      refreshStatus();
    } catch (e) {
      alert("Error: " + (e.reason || e.message));
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
      alert("Tokens claimed!");
      refreshStatus();
    } catch (e) {
      alert("Error: " + (e.reason || e.message));
    } finally {
      setLoading(false);
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
            <p>Claim $HASH — powered by Mining Hash</p>
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
            <Row label="Address" value={walletAddress ? short(walletAddress) : "—"} />
            <Row label="Status" value={status?.hasAccess ? "✅ Access" : "❌ None"} />
            <Row
              label="Time left"
              value={status?.hasAccess ? formatTime(status.timeLeft) : "—"}
            />
            <Row label="Claim" value={nextClaim} />
            <Row label="Faucet balance" value={balance} />
            <Row label="Reward" value={reward} />
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
              <button className="btn primary" onClick={claimAccess} disabled={loading}>
                {loading ? "Processing..." : "Sign quest → Get Access"}
              </button>
              <button
                className="btn secondary"
                onClick={claimTokens}
                disabled={loading || !status?.hasAccess}
              >
                Claim tokens
              </button>
              <a
                className="btn link"
                href={GALXE_QUEST_URL}
                target="_blank"
                rel="noopener"
              >
                Open quest on Galxe →
              </a>
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

function short(addr) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function Row({ label, value }) {
  return (
    <div className="row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}