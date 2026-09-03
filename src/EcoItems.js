/**
 * Products and partners of the project — STATIC, off-chain by design.
 *
 * Deliberately independent of the smart contract: this block is a curated
 * directory of partner tools, not on-chain data.
 *
 * Fields:
 *   name  — card title
 *   desc  — short human text (optional)
 *   url   — external target, opens in a new tab (optional)
 *   logo  — local file in /public/ (e.g. "/mininghash.webp")
 *   top   — pin the card to the top of the grid (optional)
 */

export const ECO_ITEMS = [
  {
    name: "LookHook",
    desc: "The main website of the team.",
    logo: "/lookhook.webp",
    url: "https://lookhook.info",
    top: true,
  },
  {
    name: "MiningHash",
    desc: "Inventory and mining $HASH.",
    url: "https://hashcoin.farm/",
    logo: "/mininghash.webp",
  },
  {
    name: "DeVote",
    desc: "The voice of the community.",
    url: "https://vote.lookhook.info",
    logo: "/DeVote.webp",
  },
  {
    name: "GemFun",
    desc: "Mining Launchpad.",
    url: "https://hashcoin.farm/gem",
    logo: "/GemFun.webp",
  },
  {
    name: "Pager",
    desc: "Web3 media AI.",
    url: "https://pager.lookhook.info",
    logo: "/Pager.webp",
  },
  {
    name: "NFT App",
    desc: "Collect NFTs.",
    url: "https://nft.lookhook.info/",
    logo: "/Cat.webp",
  },
  {
    name: "Name Service",
    desc: "Eternal Onchain Name.",
    url: "https://lookhook.info",
    logo: "/Name Service.webp",
  },
  {
    name: "Stake HASH",
    desc: "Earn by staking.",
    url: "https://lookhook.info",
    logo: "/Stake HASH.webp",
  },
];