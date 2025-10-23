// src/inventorySellManager.ts - Gestionnaire d'inventaire existant
import pino from "pino";
import { MarketFeed } from "./ws/marketFeed";
import { PolyClobClient } from "./clients/polySDK";
import { InventoryManager } from "./inventory";
import { JsonRpcProvider } from "ethers";
import { 
  MIN_SIZE_SHARES, 
  MAX_SELL_PER_ORDER_SHARES,
  MIN_NOTIONAL_SELL_USDC,
  TICK_IMPROVEMENT,
  REPLACE_COOLDOWN_MS,
  DRY_RUN
} from "./config";

const log = pino({ name: "inventory-sell-manager" });

export interface InventoryMarket {
  tokenId: string;
  shares: number;
  marketSlug: string;
  yesTokenId: string;
  noTokenId: string;
  tokenSide: 'YES' | 'NO';
}

export class InventorySellManager {
  private clob: PolyClobClient;
  private inventory: InventoryManager;
  private feed: MarketFeed;
  private provider: JsonRpcProvider;
  private activeInventoryOrders = new Map<string, {
    orderId?: string;
    price?: number;
    size?: number;
    lastReplaceTime?: number;
  }>();
  private inventoryMarkets = new Map<string, InventoryMarket>();
  private replaceCooldown = new Map<string, number>();

  constructor(
    clob: PolyClobClient,
    inventory: InventoryManager,
    feed: MarketFeed,
    provider: JsonRpcProvider
  ) {
    this.clob = clob;
    this.inventory = inventory;
    this.feed = feed;
    this.provider = provider;
  }

  /**
   * Initialise la gestion de l'inventaire existant
   */
  async initialize() {
    log.info("🔄 Initializing inventory management...");
    
    // 1. Récupérer l'inventaire actuel
    const currentInventory = this.inventory.getAllInventory();
    
    // 2. Identifier les tokens avec inventaire > 0
    const tokensWithInventory = Object.entries(currentInventory)
      .filter(([tokenId, shares]) => shares > 0.1) // Seuil minimum
      .map(([tokenId, shares]) => ({ tokenId, shares }));
    
    if (tokensWithInventory.length === 0) {
      log.info("📦 No existing inventory found");
      return;
    }

    log.info({
      tokensWithInventory: tokensWithInventory.length,
      totalShares: tokensWithInventory.reduce((sum, t) => sum + t.shares, 0)
    }, "📦 Found existing inventory");

    // 3. Pour chaque token avec inventaire, trouver le marché correspondant
    for (const { tokenId, shares } of tokensWithInventory) {
      await this.findAndSubscribeToMarket(tokenId, shares);
    }

    // 4. Démarrer la surveillance des prix
    this.startPriceMonitoring();
  }

  /**
   * Trouve le marché correspondant à un token et s'y abonne
   */
  private async findAndSubscribeToMarket(tokenId: string, shares: number) {
    try {
      // Récupérer tous les marchés disponibles
      const { discoverLiveClobMarkets } = await import("./data/discovery");
      const markets = await discoverLiveClobMarkets(200, 0); // Pas de filtre volume pour l'inventaire
      
      // Trouver le marché qui contient ce token
      const market = markets.find(m => 
        m.yesTokenId === tokenId || m.noTokenId === tokenId
      );

      if (!market) {
        log.warn({
          tokenId: tokenId.substring(0, 20) + '...',
          shares
        }, "⚠️ No market found for token with inventory");
        return;
      }

      // Déterminer le côté du token
      const tokenSide = market.yesTokenId === tokenId ? 'YES' : 'NO';
      
      const inventoryMarket: InventoryMarket = {
        tokenId,
        shares,
        marketSlug: market.slug,
        yesTokenId: market.yesTokenId,
        noTokenId: market.noTokenId,
        tokenSide
      };

      this.inventoryMarkets.set(tokenId, inventoryMarket);

      log.info({
        tokenId: tokenId.substring(0, 20) + '...',
        tokenSide,
        shares,
        marketSlug: market.slug
      }, "🎯 Subscribed to market for inventory liquidation");

      // S'abonner aux prix de ce marché
      this.feed.subscribe([tokenId], (tokenId, bestBid, bestAsk) => {
        this.handleInventoryPriceUpdate(tokenId, bestBid, bestAsk);
      });

      // Placer immédiatement un ordre SELL
      await this.placeInventorySellOrder(tokenId);

    } catch (error) {
      log.error({
        error,
        tokenId: tokenId.substring(0, 20) + '...',
        shares
      }, "❌ Failed to find market for inventory token");
    }
  }

  /**
   * Place un ordre SELL pour liquider l'inventaire
   */
  private async placeInventorySellOrder(tokenId: string) {
    const inventoryMarket = this.inventoryMarkets.get(tokenId);
    if (!inventoryMarket) return;

    try {
      // Récupérer les prix actuels
      const prices = this.feed.getLastPrices(tokenId);
      if (!prices?.bestBid || !prices?.bestAsk) {
        log.warn({
          tokenId: tokenId.substring(0, 20) + '...'
        }, "⚠️ No prices available for inventory sell order");
        return;
      }

      const { bestBid, bestAsk } = prices;
      const currentShares = this.inventory.getInventory(tokenId);
      
      if (currentShares < MIN_SIZE_SHARES) {
        log.info({
          tokenId: tokenId.substring(0, 20) + '...',
          currentShares
        }, "📦 Inventory too small for sell order");
        return;
      }

      // Calculer le prix SELL avec tick improvement
      const tickSize = 0.001;
      const improvementPrice = TICK_IMPROVEMENT * tickSize;
      const sellPrice = bestAsk - improvementPrice;
      
      // Calculer la taille (limiter par MAX_SELL_PER_ORDER_SHARES)
      const sellSize = Math.min(currentShares, MAX_SELL_PER_ORDER_SHARES);
      
      // Vérifier le notional minimum
      const notional = sellPrice * sellSize;
      if (notional < MIN_NOTIONAL_SELL_USDC) {
        log.info({
          tokenId: tokenId.substring(0, 20) + '...',
          notional
        }, "📦 Notional too small for sell order");
        return;
      }

      log.info({
        tokenId: tokenId.substring(0, 20) + '...',
        tokenSide: inventoryMarket.tokenSide,
        sellPrice: sellPrice.toFixed(4),
        sellSize: sellSize.toFixed(2),
        notional: notional.toFixed(2),
        bestAsk: bestAsk.toFixed(4),
        tickImprovement: TICK_IMPROVEMENT
      }, "💰 Placing inventory SELL order");

      if (DRY_RUN) {
        log.info("🔍 DRY RUN: Would place inventory SELL order");
        return;
      }

      // Construire et placer l'ordre
      const { buildAmounts } = await import("./lib/amounts");
      
      const amounts = buildAmounts("SELL", sellPrice, sellSize);
      const orderData = {
        maker: this.clob.getMakerAddress(),
        taker: this.clob.getAddress(),
        side: "SELL" as const,
        tokenId,
        price: sellPrice,
        size: sellSize,
        orderType: "GTC" as const,
        nonce: Date.now().toString()
      };

      const response = await this.clob.postOrder(orderData);
      
      if (response.success) {
        this.activeInventoryOrders.set(tokenId, {
          orderId: response.orderId,
          price: sellPrice,
          size: sellSize,
          lastReplaceTime: Date.now()
        });

        log.info({
          tokenId: tokenId.substring(0, 20) + '...',
          orderId: response.orderId.substring(0, 16) + '...',
          sellPrice: sellPrice.toFixed(4),
          sellSize: sellSize.toFixed(2)
        }, "✅ Inventory SELL order placed");
      }

    } catch (error) {
      log.error({
        error,
        tokenId: tokenId.substring(0, 20) + '...'
      }, "❌ Failed to place inventory SELL order");
    }
  }

  /**
   * Gère les mises à jour de prix pour l'inventaire
   */
  private handleInventoryPriceUpdate(tokenId: string, bestBid: number | null, bestAsk: number | null) {
    if (!bestBid || !bestAsk) return;

    const inventoryMarket = this.inventoryMarkets.get(tokenId);
    if (!inventoryMarket) return;

    const activeOrder = this.activeInventoryOrders.get(tokenId);
    if (!activeOrder?.orderId) return;

    // Vérifier le cooldown
    const now = Date.now();
    const lastReplace = activeOrder.lastReplaceTime || 0;
    if (now - lastReplace < REPLACE_COOLDOWN_MS) return;

    // Calculer le nouveau prix SELL
    const tickSize = 0.001;
    const improvementPrice = TICK_IMPROVEMENT * tickSize;
    const newSellPrice = bestAsk - improvementPrice;

    // Vérifier si le prix a suffisamment changé
    const priceChange = Math.abs(newSellPrice - (activeOrder.price || 0));
    if (priceChange < 0.001) return; // Moins d'1 tick de changement

    log.info({
      tokenId: tokenId.substring(0, 20) + '...',
      oldPrice: activeOrder.price?.toFixed(4),
      newPrice: newSellPrice.toFixed(4),
      priceChange: priceChange.toFixed(4),
      bestAsk: bestAsk.toFixed(4)
    }, "🔄 Replacing inventory SELL order due to price change");

    // Annuler l'ancien ordre et placer le nouveau
    this.replaceInventoryOrder(tokenId, newSellPrice);
  }

  /**
   * Remplace un ordre d'inventaire
   */
  private async replaceInventoryOrder(tokenId: string, newPrice: number) {
    const activeOrder = this.activeInventoryOrders.get(tokenId);
    if (!activeOrder?.orderId) return;

    try {
      // Annuler l'ancien ordre
      await this.clob.cancelOrders([activeOrder.orderId]);
      
      // Attendre un court délai
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Placer le nouvel ordre
      await this.placeInventorySellOrder(tokenId);

    } catch (error) {
      log.error({
        error,
        tokenId: tokenId.substring(0, 20) + '...'
      }, "❌ Failed to replace inventory order");
    }
  }

  /**
   * Démarre la surveillance des prix
   */
  private startPriceMonitoring() {
    // Surveiller les changements d'inventaire
    setInterval(() => {
      this.checkInventoryChanges();
    }, 30000); // Toutes les 30 secondes
  }

  /**
   * Vérifie les changements d'inventaire
   */
  private checkInventoryChanges() {
    for (const [tokenId, inventoryMarket] of this.inventoryMarkets.entries()) {
      const currentShares = this.inventory.getInventory(tokenId);
      
      if (currentShares < MIN_SIZE_SHARES) {
        // Plus assez d'inventaire, arrêter la surveillance
        log.info({
          tokenId: tokenId.substring(0, 20) + '...',
          remainingShares: currentShares
        }, "📦 Inventory depleted, stopping monitoring");
        
        this.inventoryMarkets.delete(tokenId);
        this.activeInventoryOrders.delete(tokenId);
      }
    }
  }

  /**
   * Met à jour l'inventaire après un fill
   */
  onInventoryUpdate(tokenId: string, newShares: number) {
    const inventoryMarket = this.inventoryMarkets.get(tokenId);
    if (!inventoryMarket) return;

    log.info({
      tokenId: tokenId.substring(0, 20) + '...',
      oldShares: inventoryMarket.shares,
      newShares
    }, "📦 Inventory updated, checking for sell orders");

    inventoryMarket.shares = newShares;

    // Si on a maintenant de l'inventaire et pas d'ordre actif, placer un SELL
    if (newShares >= MIN_SIZE_SHARES && !this.activeInventoryOrders.has(tokenId)) {
      this.placeInventorySellOrder(tokenId);
    }
  }
}
