// Vérifier les soldes EOA vs Proxy
import "dotenv/config";
import { JsonRpcProvider, Contract } from "ethers";
import { Wallet } from "@ethersproject/wallet";

const USDC_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const EXCHANGE_ADDRESS = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";

async function checkBalances() {
  const provider = new JsonRpcProvider(process.env.RPC_URL || "https://polygon-rpc.com");
  const wallet = new Wallet(process.env.PRIVATE_KEY!);
  const eoaAddress = wallet.address;
  const proxyAddress = process.env.POLY_PROXY_ADDRESS!;
  
  const usdc = new Contract(USDC_ADDRESS, USDC_ABI, provider);
  
  console.log("\n" + "=".repeat(70));
  console.log("💰 VÉRIFICATION DES SOLDES USDC");
  console.log("=".repeat(70));
  
  // EOA
  const eoaBalance = await usdc.balanceOf(eoaAddress);
  const eoaAllowance = await usdc.allowance(eoaAddress, EXCHANGE_ADDRESS);
  
  console.log("\n📍 EOA (Wallet Principal)");
  console.log("  Adresse :", eoaAddress);
  console.log("  Balance USDC :", (Number(eoaBalance) / 1e6).toFixed(2), "USDC");
  console.log("  Allowance :", (Number(eoaAllowance) / 1e6).toFixed(2), "USDC");
  
  // Proxy
  const proxyBalance = await usdc.balanceOf(proxyAddress);
  const proxyAllowance = await usdc.allowance(proxyAddress, EXCHANGE_ADDRESS);
  
  console.log("\n📍 PROXY (Compte Polymarket)");
  console.log("  Adresse :", proxyAddress);
  console.log("  Balance USDC :", (Number(proxyBalance) / 1e6).toFixed(2), "USDC");
  console.log("  Allowance :", (Number(proxyAllowance) / 1e6).toFixed(2), "USDC");
  
  console.log("\n" + "=".repeat(70));
  console.log("📊 RÉSUMÉ");
  console.log("=".repeat(70));
  console.log("Total USDC :", ((Number(eoaBalance) + Number(proxyBalance)) / 1e6).toFixed(2), "USDC");
  
  if (Number(eoaBalance) === 0 && Number(proxyBalance) > 0) {
    console.log("\n⚠️  PROBLÈME IDENTIFIÉ:");
    console.log("   Les fonds sont sur le PROXY, mais les ordres doivent être signés");
    console.log("   avec l'EOA qui N'A PAS de fonds.");
    console.log("\n💡 SOLUTION:");
    console.log("   Option 1: Transférer les USDC du proxy vers l'EOA");
    console.log("   Option 2: Utiliser une solution de délégation on-chain");
    console.log("   Option 3: Utiliser le SDK avec configuration proxy correcte");
  }
  
  console.log("\n");
}

checkBalances()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });

