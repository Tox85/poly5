// scripts/test-auth.ts - Test d'authentification CLOB
import "dotenv/config";
import { CustomClobClient } from "../src/clients/customClob";

async function main() {
  console.log("🔐 Test d'authentification CLOB Polymarket");
  console.log("==========================================");

  // Vérifier les variables d'environnement
  const requiredEnvVars = [
    'PRIVATE_KEY',
    'CLOB_API_KEY', 
    'CLOB_API_SECRET',
    'CLOB_PASSPHRASE',
    'POLY_PROXY_ADDRESS'
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`❌ Variable d'environnement manquante: ${envVar}`);
      process.exit(1);
    }
  }

  console.log("✅ Variables d'environnement présentes");

  try {
    // Initialiser le client CLOB
    const clob = new CustomClobClient(
      process.env.PRIVATE_KEY!,
      process.env.CLOB_API_KEY!,
      process.env.CLOB_API_SECRET!,
      process.env.CLOB_PASSPHRASE!,
      undefined, // baseURL par défaut
      process.env.POLY_PROXY_ADDRESS // funderAddress
    );

    console.log("✅ CustomClobClient initialisé");
    console.log(`📍 Adresse EOA: ${clob.getAddress()}`);
    console.log(`📍 Adresse Maker: ${clob.getMakerAddress()}`);

    // Test 1: Récupérer les balances
    console.log("\n🔍 Test 1: balance & allowance (USDC)...");
    try {
      const balances = await clob.getBalances();  // 👈 plus de césure
      console.log("✅ Balance-allowance:", JSON.stringify(balances, null, 2));
    } catch (error: any) {
      console.error("❌ Erreur balances:", error.response?.data || error.message);
    }

    console.log("\n🔍 Test 2: open orders...");
    try {
      const orders = await clob.getOrders();
      console.log("✅ Open orders:", JSON.stringify(orders, null, 2));
    } catch (e: any) {
      console.error("❌ Erreur orders:", e.response?.data || e.message);
    }

    // Test 3: Test d'un ordre en mode DRY (simulation)
    console.log("\n🔍 Test 3: Simulation d'un ordre...");
    
    // Utiliser un token ID de test (remplacer par un vrai token ID)
    const testTokenId = "71321045679252212594626385532706912750332728571942532289631379312455583992563";
    
    const testOrder = {
      deferExec: false,
      order: {
        salt: Math.floor(Math.random() * 1000000000000),
        maker: clob.getMakerAddress(), // Adresse proxy (fonds USDC)
        signer: clob.getAddress(), // Adresse EOA (authentification)
        taker: "0x0000000000000000000000000000000000000000",
        tokenId: testTokenId,
        makerAmount: "1000000", // 1 USDC
        takerAmount: "1000000", // 1 share
        side: "BUY",
        expiration: "0",
        nonce: "0",
        feeRateBps: "0",
        signatureType: 2, // Gnosis Safe
        signature: "0x" // Sera rempli par le client
      },
      owner: process.env.CLOB_API_KEY!,
      orderType: "GTC"
    };

    console.log("📝 Ordre de test:", JSON.stringify(testOrder, null, 2));
    console.log("⚠️  Ordre NON envoyé (test d'authentification seulement)");

  } catch (error: any) {
    console.error("❌ Erreur générale:", error.message);
    process.exit(1);
  }

  console.log("\n✅ Tests d'authentification terminés");
}

main().catch(console.error);
