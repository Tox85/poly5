// scripts/reset-inventory.ts
import "dotenv/config";
import pino from "pino";
import { InventoryManager } from "../src/inventory";
import { JsonRpcProvider } from "ethers";
import { RPC_URL, INVENTORY_PERSISTENCE_FILE } from "../src/config";

const log = pino({ name: "reset-inventory" });

async function resetInventory() {
  log.info("🔄 Réinitialisation de l'inventaire...");

  try {
    const provider = new JsonRpcProvider(RPC_URL);
    const inventory = new InventoryManager(provider);

    // Charger l'inventaire actuel
    await inventory.loadFromFile(INVENTORY_PERSISTENCE_FILE);
    
    log.info({ 
      currentInventory: inventory.getAllInventory() 
    }, "📊 Inventaire actuel (avant nettoyage)");

    // Synchroniser avec la blockchain
    log.info("🔗 Synchronisation avec la blockchain...");
    await inventory.syncAllFromOnChain();

    // Sauvegarder l'inventaire réel
    await inventory.saveToFile(INVENTORY_PERSISTENCE_FILE);

    log.info({ 
      realInventory: inventory.getAllInventory() 
    }, "✅ Inventaire réel (après synchronisation)");

    log.info("🎯 Inventaire réinitialisé avec succès !");

  } catch (error: any) {
    log.error({ error: error.message, stack: error.stack }, "❌ Erreur lors de la réinitialisation");
  }
}

resetInventory().catch((e: any) => {
  log.error({ error: e.message, stack: e.stack }, "❌ Erreur fatale");
  process.exit(1);
});
