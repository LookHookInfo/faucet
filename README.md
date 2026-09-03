# Hash Faucet — Mining Hash

Autonomous faucet. Complete the Galxe quest → get **7 days** of access → claim **20 HASH** every 24h.

- Smart contract: `0x68B3F95f2ebF0D69F224fc80b1839de02Fabc757` (Base)
- Quest: [Tweet for Faucet](https://app.galxe.com/quest/bAFdwDecXS6NRWsbYqVAgh/GCTrRtZmii)
- Backend is a **Vercel serverless function** (`/api/verify`) — no always-on bot needed.

## Architecture

```
Browser ──> /faucet (React, static)      Vercel
             │  POST /api/verify
             └-> { verify.js }  ──> Galxe API
                                   └> EIP-712 sign (private key from env)
             │  claimAccess(tx) ──> Base contract
```

- `src/` — React frontend (faucet + ecosystem grid)
- `api/verify.js` — serverless verifier (EIP-712 + Galxe check)
- `public/` — logos for the ecosystem cards

## Local dev

```bash
npm install
npm run dev
```

Vite proxies `/api` → `http://localhost:3001`. Run the fallback server in a second terminal:

```bash
node api/verify.js   # listens on 3001, serves /api/verify
```

Create `.env` from `.env.example` and fill the values.

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. Vercel → **New Project** → import the repo.
3. Build settings are auto-detected (Vite + `api/` functions):
   - Build command: `npm run build`
   - Output: `dist`
4. **Environment Variables** (Settings → Environment Variables), **not** in git:

   | Name                       | Value                                | Scope |
   |----------------------------|--------------------------------------|-------|
   | `VITE_THIRDWEB_CLIENT_ID`  | your Thirdweb Client ID              | Public |
   | `VITE_WALLETCONNECT_PROJECT_ID` | your WalletConnect Project ID   | Public |
   | `GALXE_API_TOKEN`          | your Galxe API token                 | Private |
   | `GALXE_QUEST_ID`           | `GCTrRtZmii`                         | Private |
   | `VERIFIER_PRIVATE_KEY`     | your verifier private key            | Private |

5. Deploy. The faucet lives at `/`, backend at `/api/verify`.

> The public keys in a faucet are safe; `VERIFIER_PRIVATE_KEY` must stay secret
> and is read only by the serverless function.

## Notes

- Contract owner can change the reward via `setRewardAmount(wei)`.
- Configured reward: **20 HASH** per claim, cooldown **24h**, access **7 days**.