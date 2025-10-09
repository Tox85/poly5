// scripts/sync-inventory.ts - Synchronisation des positions avec la blockchain
import "dotenv/config";
import pino from "pino";
import { CustomClobClient } from "../src/clients/customClob";
import { InventoryManager } from "../src/inventory";
import { POLY_PROXY_ADDRESS, RPC_URL, INVENTORY_PERSISTENCE_FILE } from "../src/config";
import { JsonRpcProvider } from "ethers";

const log = pino({ name: "sync-inventory" });

async function syncInventory() {
  log.info("🔄 Démarrage de la synchronisation d'inventaire...");

  const provider = new JsonRpcProvider(RPC_URL);
  const clob = new CustomClobClient(
    process.env.PRIVATE_KEY!,
    process.env.CLOB_API_KEY!,
    process.env.CLOB_API_SECRET!,
    process.env.CLOB_PASSPHRASE!,
    undefined,
    POLY_PROXY_ADDRESS
  );

  const inventory = new InventoryManager(provider, 500);

  try {
    // Charger l'inventaire local
    log.info("📦 Chargement de l'inventaire local...");
    const localInventory = inventory.getAllInventory();
    
    console.log("\n" + "=".repeat(60));
    console.log("📦 INVENTAIRE LOCAL AVANT SYNC");
    console.log("=".repeat(60));
    for (const [tokenId, shares] of Object.entries(localInventory)) {
      console.log(`   ${tokenId.substring(0, 20)}... : ${shares.toFixed(2)} shares`);
    }
    console.log("=".repeat(60));

    // Synchroniser avec la blockchain
    log.info("🔄 Synchronisation avec la blockchain...");
    await inventory.syncAllFromOnChain();

    // Sauvegarder l'inventaire synchronisé
    inventory.saveToFile(INVENTORY_PERSISTENCE_FILE);

    // Afficher le résultat final
    const syncedInventory = inventory.getAllInventory();
    console.log("\n" + "=".repeat(60));
    console.log("✅ INVENTAIRE APRÈS SYNCHRONISATION");
    console.log("=".repeat(60));
    for (const [tokenId, shares] of Object.entries(syncedInventory)) {
      console.log(`   ${tokenId.substring(0, 20)}... : ${shares.toFixed(2)} shares`);
    }
    
    const totalShares = Object.values(syncedInventory).reduce((sum, val) => sum + val, 0);
    console.log(`\n📊 Total: ${totalShares.toFixed(2)} shares`);
    console.log("=".repeat(60));

    log.info("✅ Synchronisation terminée avec succès");

  } catch (error) {
    log.error({ error }, "❌ Erreur lors de la synchronisation");
    process.exit(1);
  }
}

// Exécution du script
if (require.main === module) {
  syncInventory().catch(error => {
    log.error({ error }, "❌ Erreur dans le script de synchronisation");
    process.exit(1);
  });
}

export { syncInventory };