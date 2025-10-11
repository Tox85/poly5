// scripts/status.ts - Script de monitoring avancé du market maker
import "dotenv/config";
import pino from "pino";
import { CustomClobClient } from "../src/clients/customClob";
import { InventoryManager } from "../src/inventory";
import { 
  POLY_PROXY_ADDRESS, 
  RPC_URL, 
  MAX_INVENTORY_YES, 
  MAX_INVENTORY_NO,
  USDC_ADDRESS,
  EXCHANGE_ADDRESS,
  INVENTORY_PERSISTENCE_FILE
} from "../src/config";
import { JsonRpcProvider } from "ethers";
import { readErc20BalanceAllowance } from "../src/risk/solvency";
import { OrderCloser } from "../src/closeOrders";

const log = pino({ name: "status" });

async function getMarketStatus() {
  log.info("📊 Récupération du statut du market maker...");

  const provider = new JsonRpcProvider(RPC_URL);
  const clob = new CustomClobClient(
    process.env.PRIVATE_KEY!,
    process.env.CLOB_API_KEY!,
    process.env.CLOB_API_SECRET!,
    process.env.CLOB_PASSPHRASE!,
    undefined,
    POLY_PROXY_ADDRESS
  );

  const inventory = new InventoryManager(provider, Math.max(MAX_INVENTORY_YES, MAX_INVENTORY_NO));
  const orderCloser = new OrderCloser(clob, inventory, provider);

  try {
    // Récupérer tous les ordres ouverts
    const openOrders = await clob.getOrders({ status: 'OPEN' });
    const ordersByMarket: { [slug: string]: { yes: number; no: number; total: number } } = {};

    // Récupérer les balances et allowances
    const { balance: usdcBalanceBigInt, allowance: usdcAllowanceBigInt } = await readErc20BalanceAllowance(
      USDC_ADDRESS,
      POLY_PROXY_ADDRESS,
      EXCHANGE_ADDRESS,
      provider
    );
    const usdcBalance = Number(usdcBalanceBigInt) / 1e6;
    const usdcAllowance = Number(usdcAllowanceBigInt) / 1e6;

    // Calculer l'inventaire total et la valeur estimée
    const inventorySummary = inventory.getSummary();
    const allInventory = inventory.getAllInventory();
    let totalEstimatedValue = 0; // TODO: Calculer la valeur estimée basée sur les prix actuels

    console.log("\n" + "=".repeat(80));
    console.log("📊 STATUT DU MARKET MAKER DYNAMIQUE");
    console.log("=".repeat(80));

    console.log("\n💰 ALLOWANCES ET BALANCES:");
    console.log(`   Solde USDC: ${usdcBalance.toFixed(2)} USDC`);
    console.log(`   Allowance USDC: ${usdcAllowance.toFixed(2)} USDC`);
    console.log(`   Allowance active: ${usdcAllowance > 0 ? '✅' : '❌'}`);

    console.log("\n📦 INVENTAIRE DÉTAILLÉ:");
    if (Object.keys(allInventory).length === 0) {
      console.log("   Aucun inventaire détecté.");
    } else {
      for (const [tokenId, shares] of Object.entries(allInventory)) {
        console.log(`   ${tokenId.substring(0, 30)}... : ${shares.toFixed(2)} shares`);
      }
    }

    console.log("\n📈 MARCHÉS ACTIFS:");
    if (openOrders.length === 0 && inventorySummary.totalShares === "0.00") {
      console.log("   Aucun ordre ouvert et aucun inventaire détecté.");
    } else {
      // Regrouper les ordres par marché
      for (const order of openOrders) {
        const marketSlug = order.market.slug;
        if (!ordersByMarket[marketSlug]) {
          ordersByMarket[marketSlug] = { yes: 0, no: 0, total: 0 };
        }
        if (order.asset.assetType === 'OUTCOME' && order.asset.outcome === 'YES') {
          ordersByMarket[marketSlug].yes += 1;
        } else if (order.asset.assetType === 'OUTCOME' && order.asset.outcome === 'NO') {
          ordersByMarket[marketSlug].no += 1;
        }
        ordersByMarket[marketSlug].total += 1;
      }

      for (const slug in ordersByMarket) {
        const marketOrders = ordersByMarket[slug];
        console.log(`   - ${slug}:`);
        console.log(`     - Ordres YES: ${marketOrders.yes}`);
        console.log(`     - Ordres NO: ${marketOrders.no}`);
        console.log(`     - Total ordres ouverts: ${marketOrders.total}`);
      }
    }

    console.log("\n📊 RÉSUMÉ GLOBAL:");
    console.log(`   📦 Inventaire total: ${inventorySummary.totalShares} shares`);
    console.log(`   💰 Valeur totale estimée: ${totalEstimatedValue.toFixed(2)} USDC`);
    console.log(`   📝 Ordres ouverts totaux: ${openOrders.length}`);
    console.log(`   📁 Fichier d'inventaire: ${INVENTORY_PERSISTENCE_FILE}`);

    console.log("\n💡 RECOMMANDATIONS:");
    if (inventorySummary.totalShares === "0.00") {
      console.log("   📈 Aucun inventaire - le bot peut commencer à acheter");
    }
    if (openOrders.length === 0) {
      console.log("   📝 Aucun ordre ouvert - vérifier la configuration");
    }
    if (usdcBalance < 10) { // Seuil arbitraire pour la recommandation
      console.log("   💰 Solde USDC faible - considérer un dépôt");
    }
    if (Object.keys(allInventory).length > 0) {
      console.log("   🔄 Inventaire détecté - utiliser 'npm run sync-inventory' pour synchroniser");
    }

    console.log("\n" + "=".repeat(80));

  } catch (error) {
    log.error({ error }, "❌ Error getting market status");
  } finally {
    // Pas besoin de fermer le provider ici si le script se termine
  }
}

getMarketStatus().catch(e => {
  log.error({ error: e.message, stack: e.stack }, "❌ Erreur dans le script de statut");
  process.exit(1);
});
