// src/helpers/persistence.ts - Module de persistance pour l'inventaire
import * as fs from 'fs/promises';
import * as path from 'path';
import pino from "pino";

const log = pino({ name: "persistence" });

export class PersistenceHelper {
  /**
   * Lit un fichier JSON et retourne son contenu parsé
   */
  static async readJsonFile(filePath: string): Promise<Record<string, any>> {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        log.debug({ filePath }, "File does not exist, returning empty object");
        return {};
      }
      log.error({ error, filePath }, "Failed to read JSON file");
      throw error;
    }
  }

  /**
   * Écrit un objet dans un fichier JSON
   */
  static async writeJsonFile(filePath: string, data: Record<string, any>): Promise<void> {
    try {
      // Créer le dossier parent si nécessaire
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      
      // Écrire le fichier avec indentation
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      log.debug({ filePath, entries: Object.keys(data).length }, "JSON file written successfully");
    } catch (error) {
      log.error({ error, filePath }, "Failed to write JSON file");
      throw error;
    }
  }

  /**
   * Sauvegarde l'inventaire dans un fichier JSON
   */
  static async saveInventory(inventory: Map<string, number>, filePath: string): Promise<void> {
    // Convertir la Map en objet, en filtrant les valeurs négligeables
    const inventoryObj: Record<string, number> = {};
    for (const [tokenId, shares] of inventory.entries()) {
      if (Math.abs(shares) >= 0.01) { // Ignorer les valeurs < 0.01
        inventoryObj[tokenId] = parseFloat(shares.toFixed(2));
      }
    }

    await this.writeJsonFile(filePath, inventoryObj);
  }

  /**
   * Charge l'inventaire depuis un fichier JSON
   */
  static async loadInventory(filePath: string): Promise<Map<string, number>> {
    const inventoryObj = await this.readJsonFile(filePath);
    const inventory = new Map<string, number>();
    
    for (const [tokenId, shares] of Object.entries(inventoryObj)) {
      if (typeof shares === 'number' && Math.abs(shares) >= 0.01) {
        inventory.set(tokenId, shares);
      }
    }

    log.info({ 
      filePath, 
      loadedEntries: inventory.size,
      totalShares: Array.from(inventory.values()).reduce((sum, val) => sum + val, 0)
    }, "Inventory loaded from file");

    return inventory;
  }
}
