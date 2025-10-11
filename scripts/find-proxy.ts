// Trouve l'adresse proxy Polymarket associée à l'EOA
import "dotenv/config";
const { ClobClient } = require("@polymarket/clob-client");
const { Wallet } = require("@ethersproject/wallet");
const pino = require("pino");

const log = pino({ level: "info" });

async function findProxy() {
  const wallet = new Wallet(process.env.PRIVATE_KEY);
  const eoaAddress = wallet.address;
  
  console.log("\n" + "=".repeat(70));
  console.log("🔍 RECHERCHE DE L'ADRESSE PROXY POLYMARKET");
  console.log("=".repeat(70));
  console.log("\nEOA :", eoaAddress);
  console.log("Proxy (du .env) :", process.env.POLY_PROXY_ADDRESS);
  
  // Test 1 : Client SANS proxy (EOA pur)
  console.log("\n📡 Test 1 : Client avec EOA uniquement...");
  const clientEOA = new ClobClient(
    "https://clob.polymarket.com",
    137,
    wallet,
    {
      key: process.env.CLOB_API_KEY,
      secret: process.env.CLOB_API_SECRET,
      passphrase: process.env.CLOB_PASSPHRASE
    },
    undefined,
    undefined // Pas de proxy
  );
  
  // Récupérer les infos du compte
  try {
    const keys = await clientEOA.getApiKeys();
    console.log("✅ Auth réussie");
    console.log("  API Keys :", keys);
  } catch (e: any) {
    console.log("❌ Auth échouée :", e.message);
  }
  
  // Tenter de créer un ordre test pour voir quelle adresse le SDK utilise
  try {
    const testOrder = {
      tokenID: "42541673615301895829890290486226257940966769125829226067368474110048691276042",
      price: 0.995,
      size: 5,
      side: 0,
      feeRateBps: "0"
    };
    
    const signed = await clientEOA.createOrder(testOrder);
    console.log("\n📋 Ordre créé (EOA seul) :");
    console.log("  Maker :", signed.maker);
    console.log("  Signer :", signed.signer);
    console.log("  Signature Type :", signed.signatureType);
    
    if (signed.maker !== eoaAddress) {
      console.log("\n🎯 PROXY DÉTECTÉ !");
      console.log("  Le SDK a automatiquement utilisé l'adresse :", signed.maker);
      console.log("\n💡 Utilisez cette adresse comme POLY_PROXY_ADDRESS dans votre .env");
    } else {
      console.log("\n✅ Le SDK utilise directement l'EOA (pas de proxy)");
    }
    
  } catch (e: any) {
    console.log("❌ Erreur création ordre :", e.message);
  }
  
  // Test 2 : Vérifier les soldes
  console.log("\n📊 Vérification des soldes...");
  try {
    const balance = await clientEOA.getBalanceAllowance({
      asset_type: "COLLATERAL"
    } as any);
    
    console.log("  Balance :", (parseFloat(balance.balance || "0") / 1e6).toFixed(2), "USDC");
    console.log("  Allowance :", (parseFloat(balance.allowance || "0") / 1e6).toFixed(2), "USDC");
  } catch (e: any) {
    console.log("❌ Erreur lecture solde :", e.message);
  }
  
  console.log("\n" + "=".repeat(70));
}

findProxy()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });

