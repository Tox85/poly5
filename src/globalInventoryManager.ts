// src/globalInventoryManager.ts - Gestionnaire d'inventaire global
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

const log = pino({ name: "global-inventory-manager" });

export interface InventoryToken {
  tokenId: string;
  shares: number;
  marketSlug?: string;
  tokenSide?: 'YES' | 'NO';
  lastPriceUpdate?: number;
  activeSellOrder?: {
    orderId: string;
    price: number;
    size: number;
    lastReplaceTime: number;
  };
}

export class GlobalInventoryManager {
  private clob: PolyClobClient;
  private inventory: InventoryManager;
  private feed: MarketFeed;
  private provider: JsonRpcProvider;
  private inventoryTokens: Map<string, InventoryToken> = new Map();
  private priceUpdateInterval?: NodeJS.Timeout;
  private orderReplacementInterval?: NodeJS.Timeout;

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
   * Initialise le gestionnaire global d'inventaire
   * Scanne tout l'inventaire existant et place des ordres SELL
   */
  async initialize(): Promise<void> {
    log.info("🌍 Initializing Global Inventory Manager...");
    
    // 1. Scanner tout l'inventaire existant
    await this.scanAllInventory();
    
    // 2. Démarrer la surveillance des prix
    this.startPriceMonitoring();
    
    // 3. Démarrer le repositionnement périodique
    this.startOrderReplacement();
    
    log.info("✅ Global Inventory Manager initialized");
  }

  /**
   * Scanne tout l'inventaire existant et identifie les tokens avec des shares
   */
  private async scanAllInventory(): Promise<void> {
    log.info("🔍 Scanning all existing inventory...");
    
    const allInventory = this.inventory.getAllInventory();
    let tokensWithInventory = 0;
    
    for (const [tokenId, shares] of Object.entries(allInventory)) {
      if (shares >= MIN_SIZE_SHARES) {
        tokensWithInventory++;
        
        // Essayer de trouver le marché correspondant
        const marketInfo = await this.findMarketForToken(tokenId);
        
        const inventoryToken: InventoryToken = {
          tokenId,
          shares,
          marketSlug: marketInfo?.slug,
          tokenSide: marketInfo?.tokenSide,
          lastPriceUpdate: Date.now()
        };
        
        this.inventoryTokens.set(tokenId, inventoryToken);
        
        log.info({
          tokenId: tokenId.substring(0, 20) + '...',
          shares: shares.toFixed(2),
          marketSlug: marketInfo?.slug || 'unknown',
          tokenSide: marketInfo?.tokenSide || 'unknown'
        }, "💰 Found token with inventory");
        
        // Placer un ordre SELL immédiatement si on a les prix
        await this.placeSellOrderForToken(inventoryToken);
      }
    }
    
    log.info({
      totalTokens: Object.keys(allInventory).length,
      tokensWithInventory,
      activeTokens: this.inventoryTokens.size
    }, "📊 Inventory scan completed");
  }

  /**
   * Trouve le marché correspondant à un token
   */
  private async findMarketForToken(tokenId: string): Promise<{slug: string, tokenSide: 'YES' | 'NO'} | null> {
    try {
      // Utiliser l'API Polymarket pour trouver le marché
      // Note: Cette logique devrait être implémentée selon l'API disponible
      // Pour l'instant, on retourne null et on gérera les prix via WebSocket
      return null;
    } catch (error) {
      log.warn({
        tokenId: tokenId.substring(0, 20) + '...',
        error: error instanceof Error ? error.message : 'Unknown error'
      }, "⚠️ Could not find market for token");
      return null;
    }
  }

  /**
   * Place un ordre SELL pour un token avec inventaire
   */
  private async placeSellOrderForToken(inventoryToken: InventoryToken): Promise<void> {
    const { tokenId, shares } = inventoryToken;
    
    try {
      // Vérifier si on a des prix WebSocket
      let prices = this.feed.getLastPrices(tokenId);
      
      // Si pas de prix WebSocket, essayer l'API REST
      if (!prices?.bestBid || !prices?.bestAsk) {
        log.info({
          tokenId: tokenId.substring(0, 20) + '...',
          shares: shares.toFixed(2)
        }, "⏳ No WebSocket prices, trying REST API...");
        
        try {
          // Utiliser l'API REST comme fallback
          const restPrices = await this.getPricesFromRestApi(tokenId);
          if (restPrices) {
            prices = restPrices;
            log.info({
              tokenId: tokenId.substring(0, 20) + '...',
              bestBid: prices.bestBid,
              bestAsk: prices.bestAsk
            }, "✅ Got prices from REST API");
          }
        } catch (error) {
          log.warn({
            tokenId: tokenId.substring(0, 20) + '...',
            error: error instanceof Error ? error.message : 'Unknown error'
          }, "⚠️ Could not get prices from REST API");
        }
      }
      
      if (!prices?.bestBid || !prices?.bestAsk) {
        log.info({
          tokenId: tokenId.substring(0, 20) + '...',
          shares: shares.toFixed(2)
        }, "⏳ No prices available, will retry later");
        return;
      }

      // Calculer le prix SELL avec tick improvement
      const tickSize = 0.001;
      const sellPrice = prices.bestAsk - (TICK_IMPROVEMENT * tickSize);
      const roundedSellPrice = Math.round(sellPrice / tickSize) * tickSize;
      
      log.info({
        tokenId: tokenId.substring(0, 20) + '...',
        bestAsk: prices.bestAsk,
        tickImprovement: TICK_IMPROVEMENT,
        tickSize: tickSize,
        calculatedPrice: sellPrice,
        roundedPrice: roundedSellPrice
      }, "🔢 Price calculation debug");
      
      // Calculer la taille de l'ordre
      const orderSize = Math.min(shares, MAX_SELL_PER_ORDER_SHARES);
      const notional = orderSize * roundedSellPrice;
      
      if (notional < MIN_NOTIONAL_SELL_USDC) {
        log.debug({
          tokenId: tokenId.substring(0, 20) + '...',
          notional: notional.toFixed(2),
          minNotional: MIN_NOTIONAL_SELL_USDC
        }, "💰 Order too small, skipping");
        return;
      }

      if (DRY_RUN) {
        log.info({
          tokenId: tokenId.substring(0, 20) + '...',
          side: 'SELL',
          price: roundedSellPrice.toFixed(4),
          size: orderSize.toFixed(2),
          notional: notional.toFixed(2),
          shares: shares.toFixed(2)
        }, "🧪 DRY RUN: Would place SELL order");
        return;
      }

      // Construire l'ordre
      const order = this.buildSellOrder(tokenId, roundedSellPrice, orderSize);
      
      // Placer l'ordre
      const response = await this.clob.postOrder({ order });
      
      if (response.success) {
        log.info({
          tokenId: tokenId.substring(0, 20) + '...',
          orderId: response.orderId,
          side: 'SELL',
          price: roundedSellPrice.toFixed(4),
          size: orderSize.toFixed(2),
          notional: notional.toFixed(2),
          shares: shares.toFixed(2)
        }, "✅ SELL order placed for inventory token");
        
        // Mettre à jour le token avec l'ordre actif
        inventoryToken.activeSellOrder = {
          orderId: response.orderId!,
          price: roundedSellPrice,
          size: orderSize,
          lastReplaceTime: Date.now()
        };
        
        this.inventoryTokens.set(tokenId, inventoryToken);
      } else {
        log.error({
          tokenId: tokenId.substring(0, 20) + '...',
          error: response.error || 'Unknown error'
        }, "❌ Failed to place SELL order");
      }
      
    } catch (error) {
      log.error({
        tokenId: tokenId.substring(0, 20) + '...',
        error: error instanceof Error ? error.message : 'Unknown error'
      }, "❌ Error placing SELL order");
    }
  }

  /**
   * Construit un ordre SELL
   */
  private buildSellOrder(tokenId: string, price: number, size: number) {
    const uniqueSalt = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    const random = Math.random().toString(36).substring(2, 8);
    const clientOrderId = `GLOBAL-SELL-${tokenId.substring(0, 10)}-${price.toFixed(4)}-${Date.now()}-${random}`;
    
    // Pour SELL: maker livre CTF, taker paie USDC
    const makerAmount = BigInt(Math.round(size * 1e6)); // CTF shares
    const takerAmount = BigInt(Math.round(size * price * 1e6)); // USDC
    
    return {
      salt: uniqueSalt,
      maker: process.env.POLY_PROXY_ADDRESS!,
      signer: process.env.PRIVATE_KEY!.startsWith('0x') ? 
        process.env.PRIVATE_KEY!.slice(2) : process.env.PRIVATE_KEY!,
      taker: "0x0000000000000000000000000000000000000000",
      tokenId,
      makerAmount: makerAmount.toString(),
      takerAmount: takerAmount.toString(),
      side: "SELL",
      expiration: "0",
      nonce: "0",
      feeRateBps: "0",
      signatureType: 0, // EOA
      clientOrderId
    };
  }

  /**
   * Démarre la surveillance des prix pour tous les tokens avec inventaire
   */
  private startPriceMonitoring(): void {
    log.info("📡 Starting price monitoring for inventory tokens...");
    
    // S'abonner aux prix WebSocket pour tous les tokens avec inventaire
    for (const [tokenId, inventoryToken] of this.inventoryTokens) {
      this.feed.subscribe([tokenId], (tokenId, bestBid, bestAsk) => {
        // Callback pour les mises à jour de prix
      });
      log.debug({
        tokenId: tokenId.substring(0, 20) + '...',
        shares: inventoryToken.shares.toFixed(2)
      }, "📡 Subscribed to price updates");
    }
    
    // Vérifier les prix toutes les 5 secondes
    this.priceUpdateInterval = setInterval(() => {
      this.checkPriceUpdates();
    }, 5000);
  }

  /**
   * Vérifie les mises à jour de prix et repositionne les ordres si nécessaire
   */
  private checkPriceUpdates(): void {
    for (const [tokenId, inventoryToken] of this.inventoryTokens) {
      const prices = this.feed.getLastPrices(tokenId);
      if (!prices?.bestBid || !prices?.bestAsk) continue;
      
      // Vérifier si on doit repositionner l'ordre SELL
      if (inventoryToken.activeSellOrder) {
        const currentPrice = prices.bestAsk - (TICK_IMPROVEMENT * 0.001);
        const priceDiff = Math.abs(inventoryToken.activeSellOrder.price - currentPrice);
        
        if (priceDiff > 0.001) { // Plus d'un tick de différence
          log.info({
            tokenId: tokenId.substring(0, 20) + '...',
            currentOrderPrice: inventoryToken.activeSellOrder.price.toFixed(4),
            newPrice: currentPrice.toFixed(4),
            priceDiff: priceDiff.toFixed(4)
          }, "🔄 Price changed, will replace SELL order");
          
          // Programmer le remplacement de l'ordre
          this.scheduleOrderReplacement(inventoryToken);
        }
      }
    }
  }

  /**
   * Programme le remplacement d'un ordre
   */
  private scheduleOrderReplacement(inventoryToken: InventoryToken): void {
    const now = Date.now();
    const lastReplace = inventoryToken.activeSellOrder?.lastReplaceTime || 0;
    
    if (now - lastReplace < REPLACE_COOLDOWN_MS) {
      return; // Trop tôt pour remplacer
    }
    
    // Annuler l'ordre existant et en placer un nouveau
    this.replaceSellOrder(inventoryToken);
  }

  /**
   * Remplace un ordre SELL existant
   */
  private async replaceSellOrder(inventoryToken: InventoryToken): Promise<void> {
    if (!inventoryToken.activeSellOrder) return;
    
    try {
      // Annuler l'ordre existant
      await this.clob.cancelOrders([inventoryToken.activeSellOrder.orderId]);
      
      log.info({
        tokenId: inventoryToken.tokenId.substring(0, 20) + '...',
        orderId: inventoryToken.activeSellOrder.orderId
      }, "🗑️ Canceled old SELL order");
      
      // Placer un nouvel ordre
      await this.placeSellOrderForToken(inventoryToken);
      
    } catch (error) {
      log.error({
        tokenId: inventoryToken.tokenId.substring(0, 20) + '...',
        error: error instanceof Error ? error.message : 'Unknown error'
      }, "❌ Error replacing SELL order");
    }
  }

  /**
   * Démarre le repositionnement périodique des ordres
   */
  private startOrderReplacement(): void {
    this.orderReplacementInterval = setInterval(() => {
      this.performPeriodicReplacement();
    }, 30000); // Toutes les 30 secondes
  }

  /**
   * Effectue le repositionnement périodique
   */
  private performPeriodicReplacement(): void {
    for (const [tokenId, inventoryToken] of this.inventoryTokens) {
      if (inventoryToken.activeSellOrder) {
        const orderAge = Date.now() - inventoryToken.activeSellOrder.lastReplaceTime;
        if (orderAge > 60000) { // Plus d'1 minute
          this.scheduleOrderReplacement(inventoryToken);
        }
      }
    }
  }

  /**
   * Notifie le gestionnaire d'un changement d'inventaire
   */
  onInventoryUpdate(tokenId: string, newShares: number): void {
    if (newShares >= MIN_SIZE_SHARES) {
      // Ajouter ou mettre à jour le token
      const existingToken = this.inventoryTokens.get(tokenId);
      if (existingToken) {
        existingToken.shares = newShares;
        this.inventoryTokens.set(tokenId, existingToken);
      } else {
        // Nouveau token avec inventaire
        const inventoryToken: InventoryToken = {
          tokenId,
          shares: newShares,
          lastPriceUpdate: Date.now()
        };
        this.inventoryTokens.set(tokenId, inventoryToken);
        this.feed.subscribe([tokenId], (tokenId, bestBid, bestAsk) => {
          // Callback pour les mises à jour de prix
        });
        this.placeSellOrderForToken(inventoryToken);
      }
    } else {
      // Supprimer le token s'il n'a plus d'inventaire
      const existingToken = this.inventoryTokens.get(tokenId);
      if (existingToken && existingToken.activeSellOrder) {
        // Annuler l'ordre SELL existant
        this.clob.cancelOrders([existingToken.activeSellOrder.orderId]);
        this.inventoryTokens.delete(tokenId);
        log.info({
          tokenId: tokenId.substring(0, 20) + '...'
        }, "🗑️ Removed token from inventory management (no more shares)");
      }
    }
  }

  /**
   * Récupère les prix via l'API REST
   */
  private async getPricesFromRestApi(tokenId: string): Promise<{bestBid: number, bestAsk: number} | null> {
    try {
      // Utiliser l'API REST du CLOB pour récupérer les prix
      const orderBook = await this.clob.getOrderBook(tokenId);
      
      if (orderBook && orderBook.bids && orderBook.asks && orderBook.bids.length > 0 && orderBook.asks.length > 0) {
        const bestBid = parseFloat(orderBook.bids[0].price);
        const bestAsk = parseFloat(orderBook.asks[0].price);
        
        return { bestBid, bestAsk };
      }
      
      return null;
    } catch (error) {
      log.warn({
        tokenId: tokenId.substring(0, 20) + '...',
        error: error instanceof Error ? error.message : 'Unknown error'
      }, "⚠️ Could not get order book from REST API");
      return null;
    }
  }

  /**
   * Arrête le gestionnaire
   */
  stop(): void {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
    }
    if (this.orderReplacementInterval) {
      clearInterval(this.orderReplacementInterval);
    }
    
    log.info("🛑 Global Inventory Manager stopped");
  }
}
