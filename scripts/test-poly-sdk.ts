// Test du nouveau PolyClobClient avec signatureType correct
import "dotenv/config";
import { PolyClobClient } from "../src/clients/polySDK";
import pino from "pino";

const log = pino({ level: "info" });

async function testPolySDK() {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST DU POLYCLOBCLIENT AVEC signatureType: 2");
  console.log("=".repeat(70));
  
  const client = new PolyClobClient(
    process.env.PRIVATE_KEY!,
    process.env.CLOB_API_KEY!,
    process.env.CLOB_API_SECRET!,
    process.env.CLOB_PASSPHRASE!,
    "https://clob.polymarket.com",
    process.env.POLY_PROXY_ADDRESS // Proxy avec les fonds
  );
  
  console.log("\n✅ Client initialisé");
  console.log("  EOA :", client.getAddress());
  console.log("  Proxy :", client.getMakerAddress());
  
  // Test 1 : Vérifier solde
  console.log("\n📊 Test 1 : Vérification du solde...");
  try {
    const balance = await client.getBalanceAllowance({
      asset_type: "COLLATERAL"
    });
    console.log("✅ Balance :", (parseFloat(balance.balance || "0") / 1e6).toFixed(2), "USDC");
    console.log("✅ Allowance :", (parseFloat(balance.allowance || "0") / 1e6).toFixed(6), "USDC");
  } catch (e: any) {
    console.log("❌ Erreur :", e.message);
  }
  
  // Test 2 : Créer un ordre test  
  console.log("\n📝 Test 2 : Création d'un ordre test...");
  
  const testOrder = {
    order: {
      tokenId: "42541673615301895829890290486226257940966769125829226067368474110048691276042",
      makerAmount: "4975000", // 4.975 USDC
      takerAmount: "5000000", // 5 shares
      side: "BUY",
      feeRateBps: "0"
    },
    orderType: "GTC"
  };
  
  if (process.env.DRY_RUN === "false") {
    try {
      const response = await client.postOrder(testOrder);
      console.log("\n✅✅✅ SUCCÈS ! Ordre placé !");
      console.log("  Order ID :", response.orderID);
      console.log("  Success :", response.success);
      
      // Annuler
      console.log("\n🗑️  Annulation de l'ordre test...");
      await client.cancelOrders([response.orderID]);
      console.log("✅ Ordre annulé");
      
    } catch (e: any) {
      console.log("\n❌ Échec du placement :");
      console.log("  Erreur :", e.response?.data || e.message);
      
      if (e.response?.data?.error === "invalid signature") {
        console.log("\n⚠️  'invalid signature' - Possibilités :");
        console.log("  1. Le proxy n'est pas configuré pour accepter les signatures de l'EOA");
        console.log("  2. Il faut approuver l'EOA comme signataire du proxy on-chain");
        console.log("  3. Les credentials CLOB n'ont pas été créés avec le bon wallet");
      }
    }
  } else {
    console.log("\n⏭️  DRY_RUN=true, test non exécuté");
    console.log("   Changez DRY_RUN=false dans .env pour tester l'envoi réel");
  }
  
  console.log("\n" + "=".repeat(70));
}

testPolySDK()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });

