// scripts/check-real-balance.ts
import "dotenv/config";
import pino from "pino";
import { CustomClobClient } from "../src/clients/customClob";
import { readErc20BalanceAllowance } from "../src/risk/solvency";
import { USDC_ADDRESS, EXCHANGE_ADDRESS, RPC_URL } from "../src/config";
import { JsonRpcProvider } from "ethers";

const log = pino({ name: "check-balance" });

async function checkRealBalance() {
  log.info("💰 Vérification du solde réel...");

  try {
    const proxyAddress = process.env.POLY_PROXY_ADDRESS;
    if (!proxyAddress) {
      log.error("❌ POLY_PROXY_ADDRESS non défini");
      return;
    }

    const provider = new JsonRpcProvider(RPC_URL);
    
    // Vérifier le solde USDC
    const { balance: usdcBalance, allowance: usdcAllowance } = await readErc20BalanceAllowance(
      USDC_ADDRESS,
      proxyAddress,
      EXCHANGE_ADDRESS,
      provider
    );

    const balanceUsdc = Number(usdcBalance) / 1e6;
    const allowanceUsdc = Number(usdcAllowance) / 1e6;

    log.info({
      proxyAddress,
      balanceUsdc: balanceUsdc.toFixed(6),
      allowanceUsdc: allowanceUsdc > 1e18 ? "unlimited" : allowanceUsdc.toFixed(2)
    }, "💰 Solde USDC réel");

    // Vérifier les positions ouvertes
    const clob = new CustomClobClient(
      process.env.PRIVATE_KEY!,
      process.env.CLOB_API_KEY!,
      process.env.CLOB_API_SECRET!,
      process.env.CLOB_PASSPHRASE!,
      undefined,
      proxyAddress
    );

    log.info("📊 Récupération des ordres ouverts...");
    const openOrdersResponse = await clob.getOrders({ status: 'OPEN' });
    const openOrders = Array.isArray(openOrdersResponse) ? openOrdersResponse : (openOrdersResponse?.data || []);
    
    log.info({
      openOrdersCount: openOrders.length,
      orders: openOrders.slice(0, 5).map((o: any) => ({
        market: o.market || "N/A",
        side: o.side,
        price: o.price,
        size: o.originalSize || o.size,
        tokenId: o.asset_id?.substring(0, 30) + "..."
      }))
    }, "📋 Ordres ouverts (top 5)");

    // Recommandations
    console.log("\n" + "=".repeat(60));
    console.log("💡 ANALYSE DE LA SITUATION");
    console.log("=".repeat(60));
    
    console.log(`\n💰 Solde USDC : ${balanceUsdc.toFixed(2)} USDC`);
    console.log(`📊 Ordres ouverts : ${openOrders.length}`);
    
    if (balanceUsdc < 1.0) {
      console.log("\n⚠️  PROBLÈME : Solde USDC très faible !");
      console.log("   → Le bot ne peut pas placer d'ordres BUY");
      console.log("   → Solution : Déposer plus d'USDC sur le proxy");
    } else {
      console.log("\n✅ Solde USDC suffisant pour trader");
      console.log(`   → Peut placer des ordres de ${Math.floor(balanceUsdc)} USDC`);
    }

    if (openOrders.length > 0) {
      console.log("\n📊 Positions ouvertes détectées");
      console.log("   → Le bot devrait surveiller ces ordres");
    } else {
      console.log("\n📊 Aucune position ouverte");
      console.log("   → Le bot va commencer par placer des ordres BUY");
    }

    console.log("\n🎯 PROCHAINES ÉTAPES :");
    console.log("   1. Nettoyer .inventory.json → {}");
    console.log(`   2. Configurer NOTIONAL_PER_ORDER_USDC = ${Math.min(1, Math.floor(balanceUsdc * 0.8))}`);
    console.log("   3. Relancer le bot : npm start");
    console.log("=".repeat(60) + "\n");

  } catch (error: any) {
    log.error({ error: error.message, stack: error.stack }, "❌ Erreur lors de la vérification");
  }
}

checkRealBalance().catch((e: any) => {
  log.error({ error: e.message, stack: e.stack }, "❌ Erreur fatale");
  process.exit(1);
});
