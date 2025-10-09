#!/usr/bin/env tsx
// Script pour synchroniser l'inventaire avec les positions réelles on-chain
import "dotenv/config";
import pino from "pino";
import { JsonRpcProvider } from "ethers";
import { InventoryManager } from "../src/inventory";
import { RPC_URL, MAX_INVENTORY, INVENTORY_PERSISTENCE_FILE, POLY_PROXY_ADDRESS } from "../src/config";

const log = pino({ name: "sync-real-inventory" });

async function main() {
  log.info("🔄 Synchronisation de l'inventaire avec les positions réelles on-chain...");

  const provider = new JsonRpcProvider(RPC_URL);
  const inventory = new InventoryManager(provider, MAX_INVENTORY);

  // Tokens connus (YES et NO du marché Trump Nobel)
  const knownTokens = [
    "110231926589098351804293174455681788984678095258631881563984268486591441074567", // YES
    "7997695352317515524525062962990406756331391485123047293096327700752767906309"   // NO
  ];

  const proxyAddress = POLY_PROXY_ADDRESS;

  log.info({ proxyAddress, tokensCount: knownTokens.length }, "📦 Lecture des positions...");

  for (const tokenId of knownTokens) {
    await inventory.syncFromOnChainReal(tokenId, proxyAddress);
  }

  // Sauvegarder
  await inventory.saveToFile(INVENTORY_PERSISTENCE_FILE);

  // Afficher le résumé
  const summary = inventory.getSummary();
  log.info({
    totalTokens: summary.totalTokens,
    totalShares: summary.totalShares,
    details: summary.details
  }, "✅ Synchronisation terminée");

  const yes = inventory.getInventory(knownTokens[0]);
  const no = inventory.getInventory(knownTokens[1]);

  console.log("\n=== INVENTAIRE RÉEL ===");
  console.log(`YES shares: ${yes.toFixed(2)}`);
  console.log(`NO shares: ${no.toFixed(2)}`);
  console.log(`TOTAL: ${(yes + no).toFixed(2)} shares`);
  console.log("=======================\n");

  log.info("👋 Script terminé");
}

main().catch((error) => {
  log.error({ error }, "❌ Erreur lors de la synchronisation");
  process.exit(1);
});
