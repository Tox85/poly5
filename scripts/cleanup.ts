// scripts/cleanup.ts - Script pour annuler tous les ordres et réinitialiser l'inventaire
import "dotenv/config";
import pino from "pino";
import { CustomClobClient } from "../src/clients/customClob";
import { InventoryManager } from "../src/inventory";
import { OrderCloser } from "../src/closeOrders";
import { POLY_PROXY_ADDRESS, RPC_URL } from "../src/config";
import { JsonRpcProvider } from "ethers";

const log = pino({ name: "cleanup" });

async function cleanup() {
  log.info("🧹 Démarrage du nettoyage...");

  const provider = new JsonRpcProvider(RPC_URL);
  const clob = new CustomClobClient(
    process.env.PRIVATE_KEY!,
    process.env.CLOB_API_KEY!,
    process.env.CLOB_API_SECRET!,
    process.env.CLOB_PASSPHRASE!,
    undefined,
    POLY_PROXY_ADDRESS
  );

  const inventory = new InventoryManager(provider, 100);
  const orderCloser = new OrderCloser(clob, inventory, provider);

  try {
    // 1. Annuler tous les ordres ouverts
    log.info("📝 Annulation de tous les ordres ouverts...");
    const cancelResult = await orderCloser.closeAllOrders();
    
    if (cancelResult.success) {
      log.info({ 
        canceledCount: cancelResult.canceledOrders.length,
        failedCount: cancelResult.failedOrders.length 
      }, "✅ Ordres annulés");
    } else {
      log.warn("⚠️ Échec de l'annulation de certains ordres");
    }

    // 2. Afficher l'inventaire actuel
    log.info("📦 Inventaire actuel:");
    const summary = inventory.getSummary();
    console.log(JSON.stringify(summary, null, 2));

    // 3. Réinitialiser l'inventaire (optionnel)
    const args = process.argv.slice(2);
    if (args.includes('--reset-inventory')) {
      log.info("🔄 Réinitialisation de l'inventaire...");
      inventory.reset();
      log.info("✅ Inventaire réinitialisé");
    }

    // 4. Afficher le statut final
    log.info("📊 Statut final:");
    const finalSummary = inventory.getSummary();
    console.log(JSON.stringify(finalSummary, null, 2));

    log.info("🎉 Nettoyage terminé");

  } catch (error) {
    log.error({ error }, "❌ Erreur lors du nettoyage");
    process.exit(1);
  }
}

// Exécution du script
if (require.main === module) {
  cleanup().catch(error => {
    log.error({ error }, "❌ Erreur dans le script de nettoyage");
    process.exit(1);
  });
}

export { cleanup };
