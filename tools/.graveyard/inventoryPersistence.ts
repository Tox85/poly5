// src/inventoryPersistence.ts - Persistance de l'inventaire
import fs from "fs";
import path from "path";
import pino from "pino";

const log = pino({ name: "inventoryPersistence" });

const INVENTORY_FILE = path.join(process.cwd(), "inventory.json");

export interface InventoryData {
  [tokenId: string]: number;
}

export class InventoryPersistence {
  /**
   * Sauvegarde l'inventaire dans un fichier JSON
   */
  static saveInventory(inventory: Map<string, number>): void {
    try {
      const data: InventoryData = {};
      inventory.forEach((value, key) => {
        data[key] = value;
      });
      
      fs.writeFileSync(INVENTORY_FILE, JSON.stringify(data, null, 2));
      log.debug({ count: inventory.size }, "💾 Inventaire sauvegardé");
    } catch (error) {
      log.error({ error }, "❌ Erreur lors de la sauvegarde de l'inventaire");
    }
  }

  /**
   * Charge l'inventaire depuis le fichier JSON
   */
  static loadInventory(): Map<string, number> {
    try {
      if (!fs.existsSync(INVENTORY_FILE)) {
        log.info("📁 Aucun fichier d'inventaire trouvé, création d'un nouvel inventaire");
        return new Map();
      }

      const data = JSON.parse(fs.readFileSync(INVENTORY_FILE, "utf8"));
      const inventory = new Map<string, number>();
      
      Object.entries(data).forEach(([tokenId, shares]) => {
        inventory.set(tokenId, Number(shares));
      });

      log.info({ count: inventory.size }, "📂 Inventaire chargé depuis le fichier");
      return inventory;
    } catch (error) {
      log.error({ error }, "❌ Erreur lors du chargement de l'inventaire");
      return new Map();
    }
  }

  /**
   * Synchronise l'inventaire avec les positions réelles via le CLOB.
   * @deprecated Cette méthode utilise des valeurs hardcodées. Utilisez plutôt InventoryManager.syncAllFromClob().
   */
  static syncWithRealPositions(): Map<string, number> {
    log.warn("⚠️ syncWithRealPositions() uses hardcoded values and is deprecated. Use InventoryManager.syncAllFromClob() instead.");
    
    // Retourner un inventaire vide pour forcer l'utilisation de la vraie méthode
    return new Map<string, number>();
  }

  /**
   * Nettoie l'inventaire des valeurs négligeables
   */
  static cleanupInventory(inventory: Map<string, number>, minValue: number = 0.01): void {
    const toDelete: string[] = [];
    
    inventory.forEach((value, key) => {
      if (Math.abs(value) < minValue) {
        toDelete.push(key);
      }
    });
    
    toDelete.forEach(key => inventory.delete(key));
    
    if (toDelete.length > 0) {
      log.info({ cleaned: toDelete.length }, "🧹 Inventaire nettoyé");
    }
  }
}
