// Transférer les USDC du proxy vers l'EOA
import "dotenv/config";
import { JsonRpcProvider, Contract, Wallet as EthersV6Wallet } from "ethers";
import pino from "pino";

const log = pino({ level: "info" });

const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const USDC_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)"
];

async function transferUSDC() {
  const provider = new JsonRpcProvider(process.env.RPC_URL || "https://polygon-rpc.com");
  
  const proxyAddress = process.env.POLY_PROXY_ADDRESS!;
  const eoaPrivateKey = process.env.PRIVATE_KEY!;
  const eoaWallet = new EthersV6Wallet(eoaPrivateKey);
  const eoaAddress = eoaWallet.address;
  
  console.log("\n" + "=".repeat(70));
  console.log("💸 TRANSFERT USDC : PROXY → EOA");
  console.log("=".repeat(70));
  console.log("\nDe  :", proxyAddress);
  console.log("Vers :", eoaAddress);
  
  // Vérifier les soldes
  const usdc = new Contract(USDC_ADDRESS, USDC_ABI, provider);
  const proxyBalance = await usdc.balanceOf(proxyAddress);
  const eoaBalance = await usdc.balanceOf(eoaAddress);
  
  console.log("\nSoldes AVANT :");
  console.log("  Proxy :", (Number(proxyBalance) / 1e6).toFixed(2), "USDC");
  console.log("  EOA   :", (Number(eoaBalance) / 1e6).toFixed(2), "USDC");
  
  if (Number(proxyBalance) === 0) {
    console.log("\n❌ Le proxy n'a pas de fonds USDC !");
    console.log("   Vérifiez l'adresse du proxy dans votre .env");
    process.exit(1);
  }
  
  console.log("\n⚠️  ATTENTION :");
  console.log("   Ce script NE PEUT PAS transférer depuis le proxy car nous");
  console.log("   n'avons pas la clé privée du proxy.");
  console.log("\n💡 SOLUTIONS :");
  console.log("   1. Utilisez l'interface Polymarket pour transférer les fonds");
  console.log("   2. Utilisez un script de retrait Polymarket officiel");
  console.log("   3. Modifiez le bot pour utiliser directement l'EOA");
  console.log("\n   Pour utiliser l'EOA directement :");
  console.log("   - Les fonds doivent être sur l'EOA, pas le proxy");
  console.log("   - Ou utilisez un compte Polymarket sans proxy (nouveau compte)");
  
  console.log("\n" + "=".repeat(70));
}

transferUSDC()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });

