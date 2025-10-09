// src/marketMaker.ts
import { CustomClobClient } from "./clients/customClob";
import { SignatureType } from "@polymarket/order-utils";
import { MarketFeed } from "./ws/marketFeed";
import { UserFeed, FillEvent } from "./ws/userFeed";
import { PnLTracker } from "./metrics/pnl";
import { 
  DECIMALS, 
  PLACE_EVERY_MS, 
  USDC_ADDRESS, 
  EXCHANGE_ADDRESS, 
  POLY_PROXY_ADDRESS, 
  RPC_URL,
  MAX_INVENTORY,
  ALLOWANCE_THRESHOLD_USDC,
  MIN_SIZE_SHARES,
  MIN_NOTIONAL_USDC,
  MIN_SPREAD_MULTIPLIER,
  MAX_SPREAD_MULTIPLIER,
  PARITY_THRESHOLD,
  MAX_INVENTORY_YES,
  MAX_INVENTORY_NO,
  INVENTORY_PERSISTENCE_FILE,
  AUTO_ADJUST_NOTIONAL,
  METRICS_LOG_INTERVAL_MS,
  MAX_NOTIONAL_AT_RISK_USDC,
  RECONCILE_INTERVAL_MS,
  INVENTORY_SKEW_LAMBDA,
  ORDER_TTL_MS,
  PRICE_CHANGE_THRESHOLD,
  PROXY_ADDRESS,
  NOTIONAL_PER_ORDER_USDC,
  MAX_SELL_PER_ORDER_SHARES,
  MIN_NOTIONAL_SELL_USDC
} from "./config";
import { rootLog } from "./index";
import { buildAmounts } from "./lib/amounts";
import { enforceMinSize, calculateSafeSize, calculateSellSize } from "./risk/sizing";
import { roundPrice, roundSize, calculateSellSizeShares } from "./lib/round";
import { checkBuySolvency, checkSellSolvency, readErc20BalanceAllowance } from "./risk/solvency";
import { InventoryManager } from "./inventory";
import { AllowanceManager } from "./allowanceManager";
import { OrderCloser } from "./closeOrders";
import { JsonRpcProvider } from "ethers";

// Types locaux pour éviter l'import du SDK officiel
type OrderType = "GTC" | "IOC" | "FOK";
type Side = "BUY" | "SELL";

const log = rootLog.child({ name: "mm" });

// Helper pour convertir en unités Polymarket (6 décimales)
const toUnits = (x: number) => BigInt(Math.round(x * 1e6));

/**
 * Construit un ordre Polymarket avec les bons montants quantifiés.
 * Pour BUY: maker paie USDC, taker livre CTF (shares)
 * Pour SELL: maker livre CTF, taker paie USDC
 * 
 * IMPORTANT: Les montants sont quantifiés AVANT la signature pour garantir la cohérence
 */
function buildOrder(
  side: "BUY" | "SELL",
  tokenId: string,
  price: number, // ex: 0.047
  size: number,  // ex: 21.277 shares
  maker: string, // proxy/funder
  signer: string // EOA
) {
  // Utiliser la nouvelle logique de quantisation correcte
  const { makerAmount, takerAmount, size2, notional5 } = buildAmounts(side, price, size);

  // Générer un salt unique basé sur le timestamp + random pour éviter les collisions
  const uniqueSalt = Date.now() * 1000 + Math.floor(Math.random() * 1000);

  return {
    // champs du PostOrder → cf. docs "Place Single Order"
    salt: uniqueSalt, // Salt unique pour chaque ordre
    maker,                 // proxy/funder
    signer,                // EOA
    taker: "0x0000000000000000000000000000000000000000", // open order
    tokenId,               // ERC1155 id de l'outcome
    makerAmount: makerAmount.toString(),    // Micro-unités (BigInt → string)
    takerAmount: takerAmount.toString(),    // Micro-unités (BigInt → string)
    side,  // STRING "BUY" ou "SELL" pour l'API (pas number !)
    expiration: "0", // GTC order (Good Till Cancel)
    nonce: "0",      // Nonce par défaut
    feeRateBps: "0",
    signatureType: SignatureType.POLY_GNOSIS_SAFE, // 2 pour compte Polymarket proxy
  };
}

export type MarketMakerConfig = {
  targetSpreadCents: number;
  tickImprovement: number;
  notionalPerOrderUsdc: number;
  maxActiveOrders: number;
  replaceCooldownMs: number;
  dryRun: boolean;
  maxInventory: number;
  allowanceThresholdUsdc: number;
  minSizeShares: number;
  minNotionalUsdc: number;
  minSpreadMultiplier: number;
  maxSpreadMultiplier: number;
  autoAdjustNotional: boolean;
  priceChangeThreshold: number;
  maxDistanceFromMid: number;
};

export type MarketInfo = {
  conditionId: string;
  slug: string;
  yesTokenId: string;
  noTokenId: string;
  volume24hrClob?: number | null;
};

export class MarketMaker {
  private config: MarketMakerConfig;
  private clob: CustomClobClient;
  private feed = new MarketFeed();
  private userFeed!: UserFeed; // Initialisé dans start()
  private pnl = new PnLTracker();
  private activeOrders = new Map<string, { 
    bidId?: string; 
    askId?: string; 
    bidPrice?: number; 
    askPrice?: number; 
    bidSize?: number;
    askSize?: number;
    lastMid?: number;
    lastPlaceTime?: number;
  }>();
  private lastReplaceTime = 0;
  private marketInfo: MarketInfo | null = null;
  private lastPlaceTime = 0; // Anti-spam pour les logs
  private provider: JsonRpcProvider;
  private inventory: InventoryManager;
  private allowanceManager: AllowanceManager;
  private orderCloser: OrderCloser;
  private metricsInterval?: NodeJS.Timeout;
  private reconcileInterval?: NodeJS.Timeout;
  private inventorySyncInterval?: NodeJS.Timeout;

  constructor(config: MarketMakerConfig) {
    this.config = config;
    // Utiliser notre client personnalisé avec l'authentification L2 corrigée
    // EOA pour l'auth, proxy pour les fonds
    this.clob = new CustomClobClient(
      process.env.PRIVATE_KEY!,
      process.env.CLOB_API_KEY!,
      process.env.CLOB_API_SECRET!,
      process.env.CLOB_PASSPHRASE!,
      undefined, // baseURL par défaut
      process.env.POLY_PROXY_ADDRESS // funderAddress = proxy avec les fonds USDC
    );
    
    // Provider pour les vérifications on-chain
    this.provider = new JsonRpcProvider(RPC_URL);
    
    // Initialiser les nouveaux modules
    this.inventory = new InventoryManager(this.provider, config.maxInventory);
    this.allowanceManager = new AllowanceManager(
      this.clob, 
      this.provider, 
      config.allowanceThresholdUsdc
    );
    this.orderCloser = new OrderCloser(this.clob, this.inventory, this.provider);
  }

  async start(market: MarketInfo) {
    this.marketInfo = market;
    log.info({ market: market.slug }, "🚀 Starting market making");

    // Initialiser UserFeed (fills en temps réel)
    this.userFeed = new UserFeed(
      process.env.CLOB_API_KEY!,
      process.env.CLOB_API_SECRET!,
      process.env.CLOB_PASSPHRASE!,
      this.clob.getAddress() // Signing key = EOA
    );
    
    // Connecter au WebSocket utilisateur
    this.userFeed.connect();
    
    // Handler pour les fills (MET À JOUR L'INVENTAIRE ICI)
    this.userFeed.onFill((fill: FillEvent) => {
      this.handleFill(fill);
    });
    
    // Handler pour les changements de statut d'ordres
    this.userFeed.onOrder((order) => {
      log.debug({ 
        orderId: order.orderId.substring(0, 16) + '...',
        status: order.status 
      }, `Order status: ${order.status}`);
    });

    // CRITIQUE : Initialiser le solde USDC AVANT toute opération
    log.info("💰 Initializing USDC balance and allowance...");
    await this.allowanceManager.forceUsdcCheck();
    const usdcStatus = this.allowanceManager.getSummary();
    log.info({
      balanceUsdc: usdcStatus.usdcBalance,
      allowanceUsdc: usdcStatus.usdcAllowance,
      threshold: usdcStatus.threshold
    }, "✅ USDC balance initialized");

    // Synchroniser l'inventaire avec les positions réelles on-chain
    log.info("📦 Synchronizing inventory from blockchain...");
    const proxyAddress = POLY_PROXY_ADDRESS;
    await this.inventory.syncFromOnChainReal(market.yesTokenId, proxyAddress);
    await this.inventory.syncFromOnChainReal(market.noTokenId, proxyAddress);
    await this.inventory.saveToFile(INVENTORY_PERSISTENCE_FILE);
    
    log.info({ 
      yesShares: this.inventory.getInventory(market.yesTokenId),
      noShares: this.inventory.getInventory(market.noTokenId)
    }, "✅ Inventory synchronized for this market");

    // S'abonner aux mises à jour de prix temps réel via WebSocket
    log.info("🔌 Subscribing to real-time price updates via WebSocket...");
    this.feed.subscribe([market.yesTokenId, market.noTokenId], (tokenId, bestBid, bestAsk) => {
      this.handlePriceUpdate(tokenId, bestBid, bestAsk);
    });

    // Démarrer la logique de market making
    await this.initializeMarketMaking();
  }

  private async initializeMarketMaking() {
    if (!this.marketInfo) return;

    try {
      // ATTENDRE que le WebSocket fournisse les vrais prix (pas les données REST corrompues)
      log.info("⏳ Waiting for WebSocket to provide real market prices...");
      
      // Récupérer les prix depuis le WebSocket (source de vérité)
      let wsPricesYes = await this.getWebSocketPrices(this.marketInfo.yesTokenId);
      let wsPricesNo = await this.getWebSocketPrices(this.marketInfo.noTokenId);
      
      // FALLBACK: Si WebSocket timeout, utiliser REST API en dernier recours
      if (!wsPricesYes || !wsPricesNo) {
        log.warn("⚠️ WebSocket timeout, trying REST API as fallback...");
        const { snapshotTop } = await import("./data/book");
        
        if (!wsPricesYes) {
          const snapYesRest = await snapshotTop(this.marketInfo.yesTokenId);
          if (snapYesRest.bestBid && snapYesRest.bestAsk && 
              snapYesRest.bestBid > 0.001 && snapYesRest.bestAsk < 0.999 &&
              snapYesRest.bestBid < snapYesRest.bestAsk) {
            wsPricesYes = { bestBid: snapYesRest.bestBid, bestAsk: snapYesRest.bestAsk };
            log.info({ bestBid: snapYesRest.bestBid, bestAsk: snapYesRest.bestAsk }, "✅ YES prices from REST API");
          }
        }
        
        if (!wsPricesNo) {
          const snapNoRest = await snapshotTop(this.marketInfo.noTokenId);
          if (snapNoRest.bestBid && snapNoRest.bestAsk && 
              snapNoRest.bestBid > 0.001 && snapNoRest.bestAsk < 0.999 &&
              snapNoRest.bestBid < snapNoRest.bestAsk) {
            wsPricesNo = { bestBid: snapNoRest.bestBid, bestAsk: snapNoRest.bestAsk };
            log.info({ bestBid: snapNoRest.bestBid, bestAsk: snapNoRest.bestAsk }, "✅ NO prices from REST API");
          }
        }
      }
      
      if (!wsPricesYes || !wsPricesNo) {
        log.error("❌ Failed to get real prices from both WebSocket AND REST API, aborting");
        return;
      }
      
      const snapYes = {
        bestBid: wsPricesYes.bestBid,
        bestAsk: wsPricesYes.bestAsk,
        tickSize: 0.001, // Tick standard Polymarket
        negRisk: false
      };
      
      const snapNo = {
        bestBid: wsPricesNo.bestBid,
        bestAsk: wsPricesNo.bestAsk,
        tickSize: 0.001,
        negRisk: false
      };

      // Calculer la parité YES + NO
      const yesMid = ((snapYes.bestBid || 0) + (snapYes.bestAsk || 1)) / 2;
      const noMid = ((snapNo.bestBid || 0) + (snapNo.bestAsk || 1)) / 2;
      const parity = yesMid + noMid;
      const parityDeviation = Math.abs(parity - 1.0);

      log.info({
        market: this.marketInfo.slug,
        snapYes: { bestBid: snapYes.bestBid, bestAsk: snapYes.bestAsk, tickSize: snapYes.tickSize, mid: yesMid },
        snapNo: { bestBid: snapNo.bestBid, bestAsk: snapNo.bestAsk, tickSize: snapNo.tickSize, mid: noMid },
        parity: parity.toFixed(4),
        parityDeviation: parityDeviation.toFixed(4)
      }, "📊 Initial market snapshot with parity analysis");

      // Stratégie de parité : arbitrer si l'écart est significatif
      if (parityDeviation > PARITY_THRESHOLD) {
        log.info({
          parity,
          deviation: parityDeviation,
          threshold: PARITY_THRESHOLD
        }, "⚖️ Significant parity deviation detected, applying arbitrage strategy");
        
        // Si YES + NO > 1.01, privilégier SELL (les prix sont trop élevés)
        // Si YES + NO < 0.99, privilégier BUY (les prix sont trop bas)
        if (parity > 1.0 + PARITY_THRESHOLD) {
          log.info("📈 Parity > 1.01: Market overpriced, focusing on SELL orders");
        } else if (parity < 1.0 - PARITY_THRESHOLD) {
          log.info("📉 Parity < 0.99: Market underpriced, focusing on BUY orders");
        }
      }

      // Démarrer le market making sur les tokens Yes et No avec stratégie de parité
      await this.startMarketMaking(this.marketInfo.yesTokenId, snapYes, 'YES', snapNo);
      await this.startMarketMaking(this.marketInfo.noTokenId, snapNo, 'NO', snapYes);
      
      // Démarrer les timers de métriques et réconciliation
      this.startPeriodicTasks();
    } catch (error) {
      log.error({ error, market: this.marketInfo.slug }, "❌ Failed to initialize market making");
    }
  }

  /**
   * Démarrer les tâches périodiques (métriques, réconciliation, resync inventaire)
   */
  private startPeriodicTasks() {
    // Logs de métriques toutes les 60s
    this.metricsInterval = setInterval(() => {
      this.pnl.logMetrics();
      this.logCapitalAtRisk();
    }, METRICS_LOG_INTERVAL_MS);
    
    // Réconciliation toutes les 60s
    this.reconcileInterval = setInterval(() => {
      this.reconcileOrders();
    }, RECONCILE_INTERVAL_MS);
    
    // Resync inventaire toutes les 120s (fallback si UserFeed rate des fills)
    this.inventorySyncInterval = setInterval(() => {
      this.resyncInventoryFromBlockchain();
    }, 120_000); // 2 minutes
    
    log.info({ 
      metricsInterval: METRICS_LOG_INTERVAL_MS, 
      reconcileInterval: RECONCILE_INTERVAL_MS,
      inventorySyncInterval: 120_000
    }, "⏱️ Periodic tasks started");
  }

  /**
   * Handler pour les fills (appelé depuis UserFeed)
   * C'EST ICI qu'on met à jour l'inventaire réel
   */
  private handleFill(fill: FillEvent) {
    const tokenId = fill.asset;
    const price = parseFloat(fill.price);
    const size = parseFloat(fill.size);
    const fee = parseFloat(fill.fee || "0");
    
    // Mettre à jour l'inventaire RÉEL
    if (fill.side === "BUY") {
      this.inventory.addBuy(tokenId, size);
      log.info({
        tokenId: tokenId.substring(0, 20) + '...',
        side: "BUY",
        price: price.toFixed(4),
        size: size.toFixed(2),
        newInventory: this.inventory.getInventory(tokenId).toFixed(2)
      }, "📦 Inventory updated (BUY fill)");
    } else {
      this.inventory.addSell(tokenId, size);
      log.info({
        tokenId: tokenId.substring(0, 20) + '...',
        side: "SELL",
        price: price.toFixed(4),
        size: size.toFixed(2),
        newInventory: this.inventory.getInventory(tokenId).toFixed(2)
      }, "📦 Inventory updated (SELL fill)");
    }
    
    // Sauvegarder l'inventaire
    this.inventory.saveToFile(INVENTORY_PERSISTENCE_FILE);
    
    // Enregistrer le trade dans le PnL
    this.pnl.recordTrade({
      timestamp: fill.timestamp || Date.now(),
      tokenId,
      side: fill.side,
      price,
      size,
      fee,
      orderId: fill.orderId,
      marketSlug: this.marketInfo?.slug
    });
    
    // Forcer refresh de l'allowance USDC (le solde a changé)
    this.allowanceManager.forceUsdcCheck();
    
    // RÉACTIVITÉ POST-FILL : Tenter la jambe opposée
    this.tryQuoteOppositeSide(tokenId, fill.side);
  }
  
  /**
   * Tente de placer la jambe opposée après un fill
   */
  private async tryQuoteOppositeSide(tokenId: string, filledSide: "BUY" | "SELL") {
    if (!this.marketInfo) return;
    
    try {
      // Obtenir les prix actuels depuis le cache
      const lastPrices = this.feed.getLastPrices(tokenId);
      if (!lastPrices) return;
      
      const { bestBid, bestAsk } = lastPrices;
      
      // Vérifier que les prix sont valides
      if (bestBid === null || bestAsk === null) {
        log.warn({ tokenId: tokenId.substring(0, 20) + '...' }, "⚠️ Invalid prices for opposite leg");
        return;
      }
      
      const tokenSide = tokenId === this.marketInfo.yesTokenId ? 'YES' : 'NO';
      
      // Si on vient de BUY, tenter SELL
      if (filledSide === "BUY") {
        const currentInventory = this.inventory.getInventory(tokenId);
        if (currentInventory > 0) {
          const sellSize = calculateSellSizeShares(currentInventory, bestAsk, MAX_SELL_PER_ORDER_SHARES, 5, MIN_NOTIONAL_SELL_USDC);
          if (sellSize && sellSize >= 5) {
            log.info({
              tokenId: tokenId.substring(0, 20) + '...',
              side: "SELL",
              price: bestAsk.toFixed(4),
              size: sellSize.toFixed(2),
              reason: "Post-fill opposite leg"
            }, "🎯 Attempting opposite leg SELL");
            
            // Placer l'ordre SELL (join-only)
            await this.placeOrders(tokenId, { bestBid, bestAsk, tickSize: 0.001 }, tokenSide);
          }
        }
      }
      // Si on vient de SELL, tenter BUY
      else if (filledSide === "SELL") {
        // Calculer le notional requis
        const requiredUsdcMicro = BigInt(Math.floor(NOTIONAL_PER_ORDER_USDC * 1e6));
        
        const canBuy = await checkBuySolvency(
          requiredUsdcMicro,
          USDC_ADDRESS,
          PROXY_ADDRESS,
          EXCHANGE_ADDRESS,
          this.provider
        );
        
        if (canBuy) {
          const buySize = this.calculateOrderSize(bestBid);
          if (buySize && buySize >= 5) {
            log.info({
              tokenId: tokenId.substring(0, 20) + '...',
              side: "BUY",
              price: bestBid.toFixed(4),
              size: buySize.toFixed(2),
              reason: "Post-fill opposite leg"
            }, "🎯 Attempting opposite leg BUY");
            
            // Placer l'ordre BUY (join-only)
            await this.placeOrders(tokenId, { bestBid, bestAsk, tickSize: 0.001 }, tokenSide);
          }
        }
      }
    } catch (error) {
      log.error({ error, tokenId: tokenId.substring(0, 20) + '...' }, "❌ Error in tryQuoteOppositeSide");
    }
  }

  /**
   * Calcule le notional total à risque (ordres ouverts)
   */
  private getNotionalAtRisk(): number {
    let totalNotionalAtRisk = 0;
    
    for (const [tokenId, orders] of this.activeOrders) {
      if (orders.bidPrice && orders.bidSize) {
        totalNotionalAtRisk += orders.bidPrice * orders.bidSize;
      }
      if (orders.askPrice && orders.askSize) {
        totalNotionalAtRisk += orders.askPrice * orders.askSize;
      }
    }
    
    return totalNotionalAtRisk;
  }

  /**
   * Log le capital actuellement à risque
   */
  private logCapitalAtRisk() {
    const totalNotionalAtRisk = this.getNotionalAtRisk();
    const usdcSummary = this.allowanceManager.getSummary();
    
    log.info({
      notionalAtRisk: totalNotionalAtRisk.toFixed(2),
      maxAllowed: MAX_NOTIONAL_AT_RISK_USDC,
      percentUsed: ((totalNotionalAtRisk / MAX_NOTIONAL_AT_RISK_USDC) * 100).toFixed(1) + '%',
      usdcBalance: usdcSummary.usdcBalance,
      activeOrders: this.activeOrders.size
    }, "💼 Capital at risk");
  }

  /**
   * Réconciliation périodique : vérifie que activeOrders correspond à la réalité
   */
  private async reconcileOrders() {
    // TODO: Interroger l'API REST pour obtenir les ordres ouverts
    // et corriger activeOrders si divergence
    log.debug("🔄 Reconciliation check (TODO: implement REST API check)");
  }

  /**
   * Resync inventaire depuis la blockchain (fallback si UserFeed rate des fills)
   */
  private async resyncInventoryFromBlockchain() {
    if (!this.marketInfo) return;
    
    try {
      log.info("🔄 Resyncing inventory from blockchain...");
      
      const tokenIds = [
        this.marketInfo.yesTokenId,
        this.marketInfo.noTokenId
      ];
      
      for (const tokenId of tokenIds) {
        await this.inventory.syncFromOnChainReal(tokenId, POLY_PROXY_ADDRESS);
      }
      
      await this.inventory.saveToFile('.inventory.json');
      
      log.info("✅ Inventory resync completed from blockchain");
    } catch (error) {
      log.error({ error }, "❌ Failed to resync inventory from blockchain");
    }
  }

  private async startMarketMaking(tokenId: string, snapshot: any, tokenSide: 'YES' | 'NO', otherSnapshot?: any) {
    if (!snapshot.bestBid || !snapshot.bestAsk || !snapshot.tickSize) {
      log.warn({ tokenId, snapshot, tokenSide }, "⚠️ Incomplete snapshot data, skipping market making");
      return;
    }

    log.info({
      market: this.marketInfo?.slug,
      tokenId: tokenId.substring(0, 20) + '...',
      tokenSide,
      bestBid: snapshot.bestBid,
      bestAsk: snapshot.bestAsk,
      tickSize: snapshot.tickSize
    }, "🚀 Starting market making");

    if (!this.marketInfo) {
      log.error("No market info available");
      return;
    }
    
    // Placer les ordres initiaux avec stratégie de parité
    await this.placeOrders(tokenId, snapshot, tokenSide, otherSnapshot);
  }

  private async handlePriceUpdate(tokenId: string, bestBid: number | null, bestAsk: number | null, tokenSide?: 'YES' | 'NO') {
    if (!bestBid || !bestAsk || !this.marketInfo) return;

    // FILTRE CRITIQUE: Ignorer les données WebSocket corrompues
    const isCorruptedData = (bestBid === 0.001 && bestAsk === 0.999) || 
                           (bestBid === 0.001 && bestAsk === null) || 
                           (bestBid === null && bestAsk === 0.999);
    
    if (isCorruptedData) {
      log.debug({ 
        tokenId: tokenId.substring(0, 20) + '...',
        bestBid, 
        bestAsk, 
        reason: "Corrupted WebSocket data" 
      }, "Ignoring corrupted price update");
      return;
    }

    const currentOrders = this.activeOrders.get(tokenId);
    const determinedSide = tokenId === this.marketInfo.yesTokenId ? 'YES' : 'NO';
    
    log.info({
      tokenId: tokenId.substring(0, 20) + '...',
      bestBid: bestBid.toFixed(4),
      bestAsk: bestAsk.toFixed(4),
      spread: (bestAsk - bestBid).toFixed(4),
      determinedSide
    }, "💰 Price update received");
    
    log.info({
      tokenId: tokenId.substring(0, 20) + '...',
      hasOrders: !!currentOrders,
      bidId: currentOrders?.bidId || 'none',
      askId: currentOrders?.askId || 'none',
      bidPrice: currentOrders?.bidPrice || 'none',
      askPrice: currentOrders?.askPrice || 'none',
      lastPlaceTime: currentOrders?.lastPlaceTime || 'none'
    }, "🔍 Checking active orders");
    
    // Vérifier si on a besoin de placer des ordres (manque bidId OU askId)
    const needsBid = !currentOrders?.bidId;
    const needsAsk = !currentOrders?.askId;
    
    if (needsBid || needsAsk) {
      // Placer les ordres manquants avec les VRAIS prix WebSocket
      log.info({
        tokenId: tokenId.substring(0, 20) + '...',
        needsBid,
        needsAsk,
        reason: needsBid && needsAsk ? 'No active orders' : needsBid ? 'Missing BUY order' : 'Missing SELL order'
      }, "🎯 Placing missing orders");
      
      const prices = await this.calculateOrderPrices({ bestBid, bestAsk, tickSize: 0.001 }, determinedSide, tokenId);
      if (prices) {
        await this.placeOrders(tokenId, { bestBid, bestAsk, tickSize: 0.001 }, determinedSide, undefined, {
          placeBuy: needsBid,
          placeSell: needsAsk
        });
      }
      return;
    }

    const spread = bestAsk - bestBid;
    const targetSpread = this.config.targetSpreadCents / 100;

    // Vérifier si nos ordres sont toujours compétitifs
    const shouldReplace = this.shouldReplaceOrders(currentOrders, bestBid, bestAsk, targetSpread);

    if (shouldReplace && this.canReplaceOrders()) {
      log.info({
        tokenId: tokenId.substring(0, 20) + '...',
        currentSpread: spread.toFixed(3),
        targetSpread: targetSpread.toFixed(3),
        currentMid: ((bestBid + bestAsk) / 2).toFixed(4),
        lastMid: currentOrders.lastMid?.toFixed(4) || 'N/A'
      }, "🔄 Replacing orders due to price change or competition");
      
      await this.replaceOrders(tokenId, { bestBid, bestAsk, tickSize: 0.001 }, determinedSide);
    }
  }

  private shouldReplaceOrders(currentOrders: any, bestBid: number, bestAsk: number, targetSpread: number): boolean {
    // Remplacer si nos ordres ne sont plus au top (not inside)
    const ourBidIsBest = currentOrders.bidPrice && currentOrders.bidPrice >= bestBid;
    const ourAskIsBest = currentOrders.askPrice && currentOrders.askPrice <= bestAsk;
    const notInside = !ourBidIsBest || !ourAskIsBest;
    
    // Remplacer si le mid-price a bougé significativement
    const currentMid = (bestBid + bestAsk) / 2;
    const lastMid = currentOrders.lastMid || currentMid;
    const priceMovement = Math.abs(currentMid - lastMid) >= PRICE_CHANGE_THRESHOLD;
    
    // Remplacer si l'ordre est trop vieux (TTL)
    const orderAge = Date.now() - (currentOrders.lastPlaceTime || 0);
    const orderTooOld = orderAge > ORDER_TTL_MS;
    
    log.info({
      ourBid: currentOrders.bidPrice?.toFixed(4) || 'none',
      marketBid: bestBid.toFixed(4),
      ourAsk: currentOrders.askPrice?.toFixed(4) || 'none',
      marketAsk: bestAsk.toFixed(4),
      ourBidIsBest,
      ourAskIsBest,
      notInside,
      currentMid: currentMid.toFixed(4),
      lastMid: lastMid.toFixed(4),
      priceMovement,
      threshold: PRICE_CHANGE_THRESHOLD,
      orderAge: (orderAge / 1000).toFixed(1) + 's',
      orderTooOld,
      ttl: (ORDER_TTL_MS / 1000).toFixed(1) + 's',
      shouldReplace: notInside || priceMovement || orderTooOld
    }, "🔍 Replace orders check");
    
    if (priceMovement) {
      log.info({
        currentMid: currentMid.toFixed(4),
        lastMid: lastMid.toFixed(4),
        movement: Math.abs(currentMid - lastMid).toFixed(4),
        threshold: PRICE_CHANGE_THRESHOLD
      }, "⚡ Price movement detected, replacing orders");
    }
    
    if (orderTooOld) {
      log.info({
        orderAge: (orderAge / 1000).toFixed(1) + 's',
        ttl: (ORDER_TTL_MS / 1000).toFixed(1) + 's'
      }, "⏰ Order TTL reached, replacing orders");
    }
    
    if (notInside) {
      log.info({
        ourBid: currentOrders.bidPrice?.toFixed(4) || 'N/A',
        marketBid: bestBid.toFixed(4),
        ourAsk: currentOrders.askPrice?.toFixed(4) || 'N/A',
        marketAsk: bestAsk.toFixed(4)
      }, "🎯 Not inside market, replacing orders");
    }
    
    return notInside || priceMovement || orderTooOld;
  }

  private canReplaceOrders(): boolean {
    const now = Date.now();
    if (now - this.lastReplaceTime < this.config.replaceCooldownMs) {
      return false;
    }
    this.lastReplaceTime = now;
    return true;
  }

  /**
   * Récupère les prix réels depuis le WebSocket (source de vérité)
   * Attend jusqu'à 30 secondes pour obtenir des prix valides
   */
  private async getWebSocketPrices(tokenId: string): Promise<{bestBid: number, bestAsk: number} | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        log.warn({ tokenId: tokenId.substring(0, 20) + '...' }, "⏰ Timeout waiting for WebSocket prices");
        resolve(null);
      }, 30000); // 30 secondes max (augmenté pour marchés lents)

      // Écouter les mises à jour de prix du WebSocket
      this.feed.subscribe([tokenId], (id, bestBid, bestAsk) => {
        // Filtrer les données corrompues
        const isCorruptedData = (bestBid === 0.001 && bestAsk === 0.999) || 
                               (bestBid === 0.001 && bestAsk === null) || 
                               (bestBid === null && bestAsk === 0.999);
        
        if (isCorruptedData) {
          log.debug({ 
            tokenId: id.substring(0, 20) + '...',
            bestBid, 
            bestAsk 
          }, "Ignoring corrupted WebSocket data in getWebSocketPrices");
          return;
        }

        if (bestBid !== null && bestAsk !== null && bestBid > 0 && bestAsk < 1 && bestBid < bestAsk) {
          clearTimeout(timeout);
          log.info({
            tokenId: id.substring(0, 20) + '...',
            bestBid: bestBid.toFixed(4),
            bestAsk: bestAsk.toFixed(4)
          }, "✅ Real WebSocket prices obtained");
          resolve({ bestBid, bestAsk });
        }
      });
    });
  }

  private async placeOrders(tokenId: string, snapshot: any, tokenSide: 'YES' | 'NO', otherSnapshot?: any, options?: { placeBuy?: boolean, placeSell?: boolean }) {
    if (!this.marketInfo) return;

    try {
      // Vérifier le capital à risque AVANT de placer des ordres
      const currentNotionalAtRisk = this.getNotionalAtRisk();
      if (currentNotionalAtRisk >= MAX_NOTIONAL_AT_RISK_USDC) {
        log.warn({
          currentAtRisk: currentNotionalAtRisk.toFixed(2),
          maxAllowed: MAX_NOTIONAL_AT_RISK_USDC,
          tokenId: tokenId.substring(0, 20) + '...'
        }, "⚠️ Max notional at risk reached, skipping order placement");
        return;
      }
      
      // Calculer les prix avec stratégie de parité (pas besoin de fetchLastPrice ici)
      const prices = await this.calculateOrderPrices(snapshot, tokenSide, tokenId, otherSnapshot);
      if (!prices || !prices.bidPrice || !prices.askPrice) {
        log.debug({ 
          tokenId: tokenId.substring(0, 20) + '...',
          tokenSide 
        }, "No valid prices calculated, skipping orders");
        return;
      }

      const { bidPrice, askPrice, parityBias, midPrice } = prices;
      
      // Mémoriser le mid-price pour détecter les mouvements futurs
      const existingOrders = this.activeOrders.get(tokenId) || {};
      this.activeOrders.set(tokenId, { ...existingOrders, lastMid: midPrice });

      // Obtenir l'inventaire actuel et les limites
      const currentInventory = this.inventory.getInventory(tokenId);
      const maxInventory = tokenSide === 'YES' ? MAX_INVENTORY_YES : MAX_INVENTORY_NO;
      
      log.info({
        tokenId: tokenId.substring(0, 20) + '...',
        tokenSide,
        currentInventory: currentInventory.toFixed(2),
        maxInventory,
        hasInventory: currentInventory > 0
      }, "📦 Current inventory status");

      // Calculer les tailles séparément pour BUY et SELL
      const buySize = this.calculateOrderSize(bidPrice);
      const sellSize = currentInventory > 0 ? calculateSellSizeShares(currentInventory, askPrice, MAX_SELL_PER_ORDER_SHARES, 5, MIN_NOTIONAL_SELL_USDC) : null;

      log.info({
        slug: this.marketInfo.slug,
        tokenId: tokenId.substring(0, 20) + '...',
        tokenSide,
        bidPrice: bidPrice.toFixed(3),
        askPrice: askPrice.toFixed(3),
        buySize: buySize?.toString() || 'null',
        sellSize: sellSize?.toString() || 'null',
        currentInventory,
        maxInventory,
        parityBias
      }, "📝 Calculating order sizes");

      // Vérifications de solvabilité et d'inventaire
      const buyAmounts = buySize ? buildAmounts("BUY", bidPrice, buySize) : null;
      const sellAmounts = sellSize ? buildAmounts("SELL", askPrice, sellSize) : null;
      
      const buySolvent = buyAmounts ? await this.checkBuySolvency(buyAmounts.makerAmount) : false;
      const sellSolvent = sellAmounts ? await this.checkSellSolvency(tokenId, sellAmounts.makerAmount) : false;
      const canBuy = buySize !== null && buySolvent && (currentInventory + (buySize || 0)) <= maxInventory;
      const canSell = sellSize !== null && sellSolvent && currentInventory >= (sellSize || 0);

      // PRIORISER LA VENTE QUAND ON A DE L'INVENTAIRE (logique de cycle)
      // Si on a de l'inventaire, on vend d'abord pour libérer du capital
      const hasInventory = currentInventory > 0;
      const shouldPlaceBuy = canBuy && (parityBias !== 'SELL') && (options?.placeBuy !== false) && !hasInventory;
      const shouldPlaceSell = canSell && (parityBias !== 'BUY') && (options?.placeSell !== false);
      
      log.info({
        tokenId: tokenId.substring(0, 20) + '...',
        tokenSide,
        hasInventory,
        currentInventory: currentInventory.toFixed(2),
        shouldPlaceBuy,
        shouldPlaceSell,
        reason: hasInventory ? 'Priority to SELL (has inventory)' : 'Normal BUY/SELL logic'
      }, "🎯 Order placement decision");

      log.info({
        slug: this.marketInfo.slug,
        tokenId: tokenId.substring(0, 20) + '...',
        tokenSide,
        buySolvent,
        sellSolvent,
        canBuy,
        canSell,
        shouldPlaceBuy,
        shouldPlaceSell,
        currentInventory,
        maxInventory,
        parityBias
      }, "🔍 Solvency and inventory checks");

      let buyResp = null;
      let sellResp = null;

      // Placer l'ordre BUY si possible
      if (shouldPlaceBuy) {
        try {
          const maker = this.clob.getMakerAddress();
          const signer = this.clob.getAddress();
          const buyAmounts = buildAmounts("BUY", bidPrice, buySize!);
          const buyOrderData = buildOrder("BUY", tokenId, bidPrice, buySize!, maker, signer);
          
          const buyOrder = {
            deferExec: false,
            order: { ...buyOrderData, signature: "0x" },
            owner: process.env.CLOB_API_KEY!,
            orderType: "GTC" as OrderType
          };

          log.info({
            slug: this.marketInfo.slug,
            tokenId: tokenId.substring(0, 20) + '...',
            tokenSide,
            side: "BUY",
            price: bidPrice.toFixed(4),
            size: buySize,
            notional: (bidPrice * (buySize || 0)).toFixed(5),
            makerAmount: buyAmounts.makerAmount.toString(),
            takerAmount: buyAmounts.takerAmount.toString(),
            currentInventory
          }, "placing BUY order (solvent + can buy)");

          buyResp = await this.clob.postOrder(buyOrder);

          if (buyResp && (buyResp.orderId || buyResp.orderID)) {
            const orderId = buyResp.orderId || buyResp.orderID;
            
            // Stocker l'ordre actif (sera mis à jour sur fill via UserFeed)
            const existing = this.activeOrders.get(tokenId) || {};
            this.activeOrders.set(tokenId, { 
              ...existing, 
              bidId: orderId, 
              bidPrice,
              bidSize: buySize!,
              lastPlaceTime: Date.now()
            });
            
            log.info({ 
              slug: this.marketInfo.slug,
              tokenId: tokenId.substring(0, 20) + '...',
              tokenSide,
              bidId: orderId,
              bidPrice: bidPrice.toFixed(4),
              size: buySize!,
              notional: (bidPrice * buySize!).toFixed(2)
            }, "✅ BUY order POSTED (inventory will update on fill)");
          }
        } catch (error) {
          log.error({ error, tokenId: tokenId.substring(0, 20) + '...', tokenSide, side: "BUY" }, "❌ Error placing BUY order");
        }
      } else {
        log.warn({
          slug: this.marketInfo.slug,
          tokenSide,
          side: "BUY",
          makerAmount: buyAmounts?.makerAmount.toString() || "0"
        }, !canBuy ? "skip BUY (not enough USDC balance/allowance)" : 
             !shouldPlaceBuy ? "skip BUY (parity bias: SELL)" : "skip BUY (inventory limit reached)");
      }

      // Placer l'ordre SELL si possible
      if (shouldPlaceSell) {
        try {
          // Vérifier l'approbation ERC-1155 pour l'Exchange
          const { isApprovedForAll } = await import("./lib/erc1155");
          const { EXCHANGE_ADDRESS } = await import("./config");
          
          const isApproved = await isApprovedForAll(
            this.provider,
            this.clob.getMakerAddress(),
            EXCHANGE_ADDRESS
          );
          
          if (!isApproved) {
            log.warn({
              slug: this.marketInfo.slug,
              tokenId: tokenId.substring(0, 20) + '...',
              tokenSide
            }, "⚠️ ERC-1155 not approved for Exchange. Please approve manually on Polymarket or via setApprovalForAll()");
            // On continue quand même car l'approbation peut être faite manuellement
          }
          
          const maker = this.clob.getMakerAddress();
          const signer = this.clob.getAddress();
          const sellAmounts = buildAmounts("SELL", askPrice, sellSize!);
          const sellOrderData = buildOrder("SELL", tokenId, askPrice, sellSize!, maker, signer);
          
          const sellOrder = {
            deferExec: false,
            order: { ...sellOrderData, signature: "0x" },
            owner: process.env.CLOB_API_KEY!,
            orderType: "GTC" as OrderType
          };

          log.info({
            slug: this.marketInfo.slug,
            tokenId: tokenId.substring(0, 20) + '...',
            tokenSide,
            side: "SELL",
            price: askPrice.toFixed(4),
            size: sellSize,
            notional: (askPrice * (sellSize || 0)).toFixed(5),
            makerAmount: sellAmounts.makerAmount.toString(),
            takerAmount: sellAmounts.takerAmount.toString(),
            currentInventory
          }, "placing SELL order (solvent + can sell)");

          sellResp = await this.clob.postOrder(sellOrder);

          if (sellResp && (sellResp.orderId || sellResp.orderID)) {
            const orderId = sellResp.orderId || sellResp.orderID;
            
            // Stocker l'ordre actif (sera mis à jour sur fill via UserFeed)
            const existing = this.activeOrders.get(tokenId) || {};
            this.activeOrders.set(tokenId, { 
              ...existing, 
              askId: orderId, 
              askPrice,
              askSize: sellSize!,
              lastPlaceTime: Date.now()
            });
            
            log.info({ 
              slug: this.marketInfo.slug,
              tokenId: tokenId.substring(0, 20) + '...',
              tokenSide,
              askId: orderId,
              askPrice: askPrice.toFixed(4),
              size: sellSize!,
              notional: (askPrice * sellSize!).toFixed(2)
            }, "✅ SELL order POSTED (inventory will update on fill)");
          }
        } catch (error) {
          log.error({ error, tokenId: tokenId.substring(0, 20) + '...', tokenSide, side: "SELL" }, "❌ Error placing SELL order");
        }
      } else {
        log.warn({
          slug: this.marketInfo.slug,
          tokenSide,
          side: "SELL",
          makerAmount: sellAmounts?.makerAmount.toString() || "0"
        }, !canSell ? "skip SELL (not enough inventory)" : 
             !shouldPlaceSell ? "skip SELL (parity bias: BUY)" : "skip SELL (invalid size)");
      }

      if (!buyResp?.success && !sellResp?.success) {
        log.warn({
          slug: this.marketInfo.slug,
          tokenId: tokenId.substring(0, 20) + '...',
          tokenSide
        }, "No orders placed");
      } else {
        log.info({
          slug: this.marketInfo.slug,
          tokenId: tokenId.substring(0, 20) + '...',
          tokenSide,
          buyResp: buyResp?.orderId || buyResp?.orderID || null,
          sellResp: sellResp?.orderId || sellResp?.orderID || null
        }, "✅ Orders placed successfully");
      }

    } catch (error) {
      log.error({ error, tokenId: tokenId.substring(0, 20) + '...', tokenSide }, "❌ Error placing orders");
    }
  }

  /**
   * Vérifie la solvabilité pour un achat (USDC)
   */
  private async checkBuySolvency(requiredAmount: bigint): Promise<boolean> {
    try {
      // UTILISER le cache de AllowanceManager au lieu de relire on-chain
      // Le cache est déjà initialisé au démarrage et mis à jour automatiquement
      const summary = this.allowanceManager.getSummary();
      
      // Convertir le solde de string vers bigint (unités: 1e6 pour USDC)
      const balanceUsdc = BigInt(Math.round(parseFloat(summary.usdcBalance) * 1e6));
      const allowanceUsdc = BigInt(Math.round(parseFloat(summary.usdcAllowance) * 1e6));
      
      const hasFunds = balanceUsdc >= requiredAmount;
      const hasAllowance = allowanceUsdc >= requiredAmount;
      
      log.debug({
        requiredUsdc: (Number(requiredAmount) / 1e6).toFixed(2),
        balanceUsdc: summary.usdcBalance,
        allowanceUsdc: summary.usdcAllowance,
        hasFunds,
        hasAllowance
      }, "💰 Buy solvency check");
      
      return hasFunds && hasAllowance;
    } catch (error) {
      log.error({ error, requiredAmount: requiredAmount.toString() }, "❌ Error checking buy solvency");
      return false;
    }
  }

  /**
   * Vérifie la solvabilité pour une vente (inventaire)
   */
  private async checkSellSolvency(tokenId: string, requiredAmount: bigint): Promise<boolean> {
    try {
      // Pour l'instant, on vérifie seulement l'inventaire local
      // TODO: Ajouter la vérification on-chain des tokens ERC1155
      const availableShares = this.inventory.getInventory(tokenId);
      const requiredShares = Number(requiredAmount) / 1e6; // Convertir de micro-unités
      
      return availableShares >= requiredShares;
    } catch (error) {
      log.error({ error, tokenId: tokenId.substring(0, 20) + '...', requiredAmount: requiredAmount.toString() }, "❌ Error checking sell solvency");
      return false;
    }
  }

  private async calculateOrderPrices(
    snapshot: any, 
    tokenSide: 'YES' | 'NO',
    tokenId: string,
    otherSnapshot?: any
  ): Promise<{ bidPrice: number | null; askPrice: number | null; parityBias?: 'BUY' | 'SELL'; midPrice: number } | null> {
    const bestBid = snapshot.bestBid;
    const bestAsk = snapshot.bestAsk;
    const tickSize = snapshot.tickSize || 0.001;
    
    // VALIDATION CRITIQUE: Vérifier que les prix sont réels
    if (bestBid === null || bestAsk === null || bestBid <= 0 || bestAsk >= 1) {
      log.warn({ 
        tokenId: tokenId.substring(0, 20) + '...',
        bestBid, 
        bestAsk, 
        tokenSide 
      }, "📊 Invalid or null prices from WebSocket, skipping");
      return null;
    }
    
    // Vérifier que le carnet est valide
    if (bestBid <= 0 || bestAsk >= 1 || bestBid >= bestAsk) {
      log.warn({ bestBid, bestAsk, tokenSide }, "📊 Invalid order book, skipping");
      return null;
    }

    const midPrice = (bestBid + bestAsk) / 2;
    const rawSpread = bestAsk - bestBid;
    const baseTargetSpread = this.config.targetSpreadCents / 100;
    
    // Récupérer le dernier prix tradé réel (via CLOB ou mid-price)
    // Évite les valeurs aberrantes en utilisant directement le mid-price actuel
    const { fetchLastTradePrice } = await import("./data/book");
    const lastTradePrice = await fetchLastTradePrice(tokenId, this.clob);
    
    // Détecter un mouvement de prix significatif SEULEMENT si le prix est cohérent
    if (lastTradePrice) {
      const priceChange = Math.abs(lastTradePrice - midPrice);
      
      // Ignorer les valeurs aberrantes (>5¢ de différence)
      if (priceChange > this.config.maxDistanceFromMid) {
        log.warn({
          tokenSide,
          midPrice: midPrice.toFixed(4),
          lastTradePrice: lastTradePrice.toFixed(4),
          priceChange: priceChange.toFixed(4),
          maxDistance: this.config.maxDistanceFromMid
        }, "⚠️ Last trade price aberrant, ignoring");
      } else if (priceChange > this.config.priceChangeThreshold) {
        log.info({
          tokenSide,
          midPrice: midPrice.toFixed(4),
          lastTradePrice: lastTradePrice.toFixed(4),
          priceChange: priceChange.toFixed(4),
          threshold: this.config.priceChangeThreshold
        }, "⚡ Significant price movement detected");
      }
    }

    // Accepter les spreads serrés - ils sont profitables pour le market making
    // Seulement rejeter si le spread est vraiment trop large (> 50%)
    if (rawSpread > 0.5) {
      log.debug({ 
        rawSpread: rawSpread.toFixed(4), 
        baseTargetSpread: baseTargetSpread.toFixed(4),
        tokenSide 
      }, "📊 Spread too wide (>50%), skipping");
      return null;
    }

    // Amélioration du spread dynamique avec scaling plus fluide
    let dynamicSpread = baseTargetSpread;
    const spreadRatio = rawSpread / baseTargetSpread;
    
    if (spreadRatio > 1) {
      // Si rawSpread est plus grand que base, permettre à dynamicSpread de croître mais limiter  
      dynamicSpread = Math.min(
        rawSpread * this.config.minSpreadMultiplier,
        rawSpread * this.config.maxSpreadMultiplier
      );
    } else {
      // Si rawSpread est plus petit que base (spread serré), utiliser un spread minimum
      // mais rester compétitif en utilisant le spread réel
      dynamicSpread = Math.max(rawSpread * 0.5, baseTargetSpread * 0.1);
    }

    // Stratégie de parité si on a les deux snapshots
    let parityBias: 'BUY' | 'SELL' | undefined = undefined;
    if (otherSnapshot && otherSnapshot.bestBid && otherSnapshot.bestAsk) {
      const otherMid = (otherSnapshot.bestBid + otherSnapshot.bestAsk) / 2;
      const parity = midPrice + otherMid;
      const parityDeviation = Math.abs(parity - 1.0);

      if (parityDeviation > PARITY_THRESHOLD) {
        if (parity > 1.0 + PARITY_THRESHOLD) {
          parityBias = 'SELL'; // Market overpriced, focus on selling
        } else if (parity < 1.0 - PARITY_THRESHOLD) {
          parityBias = 'BUY'; // Market underpriced, focus on buying
        }
        
        log.debug({
          tokenSide,
          parity: parity.toFixed(4),
          parityDeviation: parityDeviation.toFixed(4),
          bias: parityBias
        }, "⚖️ Parity strategy applied");
      }
    }

    log.debug({
      tokenSide,
      rawSpread: rawSpread.toFixed(4),
      baseTargetSpread: baseTargetSpread.toFixed(4),
      dynamicSpread: dynamicSpread.toFixed(4),
      spreadRatio: spreadRatio.toFixed(2),
      parityBias
    }, "📊 Dynamic spread calculation");

    // Calculer les prix EXACTEMENT au best bid/ask pour capturer le spread
    // Stratégie JOIN-ONLY : rejoindre exactement le meilleur prix (pas d'amélioration)
    let bidPrice = bestBid; // Exactement au best bid
    let askPrice = bestAsk; // Exactement au best ask
    
    // SKEW D'INVENTAIRE DÉSACTIVÉ TEMPORAIREMENT (causait des ordres non compétitifs)
    // Le bot va placer aux meilleurs prix pour maximiser les fills
    const inv = this.inventory.getInventory(tokenId);
    const skew = 0; // INVENTORY_SKEW_LAMBDA * inv * tickSize;
    
    // Arrondir au tick size (garantir que les prix sont valides)
    bidPrice = Math.round(bidPrice / tickSize) * tickSize;
    askPrice = Math.round(askPrice / tickSize) * tickSize;
    
    if (inv !== 0) {
      log.debug({
        tokenId: tokenId.substring(0, 20) + '...',
        inventory: inv.toFixed(2),
        skew: (skew * 100).toFixed(2) + '¢',
        bidJoined: bidPrice.toFixed(4),
        askJoined: askPrice.toFixed(4)
      }, "📊 JOIN-ONLY pricing (skew disabled)");
    }
    
    // Protection : ne pas aller au-delà du spread minimum
    const minSpread = this.config.targetSpreadCents / 100;
    const currentSpread = askPrice - bidPrice;
    
    if (currentSpread < minSpread) {
      log.debug({
        currentSpread: currentSpread.toFixed(4),
        minSpread: minSpread.toFixed(4),
        tokenSide
      }, "📊 Spread too tight, using calculated prices anyway");
    }

    // Vérifier la distance maximale du mid-price (protection contre spreads aberrants)
    if (Math.abs(bidPrice - midPrice) > this.config.maxDistanceFromMid) {
      log.warn({ 
        bidPrice, 
        midPrice, 
        distance: Math.abs(bidPrice - midPrice).toFixed(4),
        maxDistance: this.config.maxDistanceFromMid,
        tokenSide 
      }, "📊 Best bid too far from mid, skipping market");
      return null;
    }

    if (Math.abs(askPrice - midPrice) > this.config.maxDistanceFromMid) {
      log.warn({ 
        askPrice, 
        midPrice, 
        distance: Math.abs(askPrice - midPrice).toFixed(4),
        maxDistance: this.config.maxDistanceFromMid,
        tokenSide 
      }, "📊 Best ask too far from mid, skipping market");
      return null;
    }

    // Protection cross-the-book
    if (bidPrice >= bestAsk || askPrice <= bestBid) {
      log.warn({ 
        bidPrice, 
        askPrice, 
        bestBid, 
        bestAsk, 
        tokenSide 
      }, "📊 Calculated prices cross the book, skipping");
      return null;
    }

    // Vérification finale
    if (bidPrice >= askPrice) {
      log.warn({ 
        bidPrice, 
        askPrice, 
        tokenSide 
      }, "📊 Final prices still cross the book, skipping");
      return null;
    }

    return {
      bidPrice: parseFloat(bidPrice.toFixed(6)),
      askPrice: parseFloat(askPrice.toFixed(6)),
      parityBias,
      midPrice: parseFloat(midPrice.toFixed(6))
    };
  }

  /**
   * Calcule la taille d'un ordre BUY en adaptant le notional au capital disponible si AUTO_ADJUST_NOTIONAL est activé.
   * Cette méthode utilise la logique unifiée de risk/sizing et respecte les contraintes de notional minimum.
   */
  private calculateOrderSize(price: number): number | null {
    // Calcule le notional en fonction du solde USDC actuel si AUTO_ADJUST_NOTIONAL est activé
    let notional = this.config.notionalPerOrderUsdc;
    
    if (this.config.autoAdjustNotional) {
      const summary = this.allowanceManager.getSummary();
      const balanceUsdc = parseFloat(summary.usdcBalance);
      
      // Si le solde est insuffisant pour le notional minimum, on ne peut pas trader
      if (balanceUsdc < this.config.minNotionalUsdc) {
        log.warn({ 
          balanceUsdc: balanceUsdc.toFixed(2),
          minNotional: this.config.minNotionalUsdc,
          summary
        }, "⚠️ USDC balance too low for minimum notional");
        return null;
      }
      
      // Garder une petite réserve (10% ou 0.5 USDC minimum)
      const reserve = Math.max(0.5, this.config.minNotionalUsdc * 0.1);
      const availableForTrade = Math.max(0, balanceUsdc - reserve);
      
      // Ajuster le notional, mais garantir au moins minNotionalUsdc si possible
      notional = Math.min(this.config.notionalPerOrderUsdc, availableForTrade);
      notional = Math.max(notional, Math.min(this.config.minNotionalUsdc, balanceUsdc - 0.5));
      
      log.debug({
        originalNotional: this.config.notionalPerOrderUsdc,
        balanceUsdc: balanceUsdc.toFixed(2),
        reserve: reserve.toFixed(2),
        adjustedNotional: notional.toFixed(2)
      }, "📊 Notional adjusted based on balance");
    }
    
    // Vérifier que le notional est suffisant
    if (notional < this.config.minNotionalUsdc) {
      log.warn({ 
        notional: notional.toFixed(2), 
        minNotional: this.config.minNotionalUsdc 
      }, "📊 Notional too low after adjustment");
      return null;
    }
    
    // CRITIQUE: Polymarket exige un minimum de 5 shares pour tous les ordres
    // Pour les prix élevés, il faut augmenter le notional pour atteindre ce minimum
    const minShares = 5; // Minimum Polymarket
    const requiredNotional = price * minShares; // Notional requis pour atteindre 5 shares
    
    // Si le notional actuel ne permet pas d'atteindre 5 shares, l'augmenter
    if (notional < requiredNotional) {
      const oldNotional = notional;
      notional = Math.max(requiredNotional, this.config.minNotionalUsdc);
      
      log.debug({
        price: price.toFixed(4),
        minShares,
        oldNotional: oldNotional.toFixed(2),
        requiredNotional: requiredNotional.toFixed(2),
        newNotional: notional.toFixed(2)
      }, "📊 Notional increased to meet minimum shares requirement");
    }
    
    log.debug({
      price: price.toFixed(4),
      minShares,
      notional: notional.toFixed(2),
      expectedShares: (notional / price).toFixed(2)
    }, "📊 Order size calculation");
    
    // Utiliser la logique de sizing sécurisée avec le minimum Polymarket
    return calculateSafeSize(
      notional,
      price,
      minShares,
      this.config.minNotionalUsdc
    );
  }

  /**
   * Calcule la taille d'un ordre SELL avec arrondi vers le BAS strict.
   * Garantit qu'on ne vend JAMAIS plus que l'inventaire disponible.
   */
  private calculateSellSize(price: number, availableShares: number): number | null {
    // Vérifier qu'on a assez de shares pour vendre
    if (availableShares < this.config.minSizeShares) {
      log.debug({ 
        availableShares: availableShares.toFixed(2), 
        minSize: this.config.minSizeShares 
      }, "📊 Not enough shares to sell");
      return null;
    }
    
    // SELL sizing : dissocier du notional BUY, basé sur l'inventaire disponible
    const minShares = this.config.minSizeShares;
    const maxSharesPerOrder = 25; // Cap plus conservateur par ordre
    
    // Calculer la taille basée sur l'inventaire disponible
    let size = Math.floor(Math.min(availableShares, maxSharesPerOrder) * 100) / 100;
    
    // Vérifier le minimum de shares
    if (size < minShares) {
      log.debug({ 
        availableShares: availableShares.toFixed(2),
        calculatedSize: size.toFixed(2),
        minSize: minShares 
      }, "📊 Not enough shares for minimum order size");
      return null;
    }
    
    // Vérifier le notional minimum (beaucoup plus bas que BUY)
    const minNotionalSell = Math.max(1.0, price * minShares); // Au moins 1 USDC ou prix*5 shares
    const finalNotional = price * size;
    
    if (finalNotional < minNotionalSell) {
      log.debug({ 
        size: size.toFixed(2),
        price: price.toFixed(4),
        finalNotional: finalNotional.toFixed(2), 
        minNotionalSell: minNotionalSell.toFixed(2)
      }, "📊 Final notional too low for SELL");
      return null;
    }
    
    log.debug({
      price: price.toFixed(4),
      availableShares: availableShares.toFixed(2),
      calculatedSize: size.toFixed(2),
      finalNotional: finalNotional.toFixed(2)
    }, "📊 SELL size calculated successfully");
    
    return size;
  }

  private async replaceOrders(tokenId: string, snapshot: any, tokenSide: 'YES' | 'NO') {
    if (!this.marketInfo) {
      log.error("No market info available for replacement");
      return;
    }

    // Annuler les ordres existants
    await this.cancelOrders(tokenId);
    
    // Placer de nouveaux ordres (qui calculeront les nouveaux prix)
    await this.placeOrders(tokenId, snapshot, tokenSide);
  }

  private async cancelOrders(tokenId: string) {
    const orders = this.activeOrders.get(tokenId);
    if (!orders?.bidId || !orders?.askId) return;

    try {
      const cancelResp = await this.clob.cancelOrders([orders.bidId, orders.askId]);
      
      if (cancelResp) {
        log.info({
          tokenId: tokenId.substring(0, 20) + '...',
          canceledOrders: cancelResp.canceled || [orders.bidId, orders.askId]
        }, "🗑️ Orders canceled");
      }

      // Nettoyer le cache
      this.activeOrders.delete(tokenId);
    } catch (error) {
      log.error({ error, tokenId: tokenId.substring(0, 20) + '...' }, "❌ Error canceling orders");
    }
  }

  async stop() {
    log.info({ market: this.marketInfo?.slug }, "🛑 Stopping market maker");
    
    // Arrêter les timers
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval);
    }
    if (this.inventorySyncInterval) {
      clearInterval(this.inventorySyncInterval);
    }
    
    // Annuler tous les ordres actifs
    for (const [tokenId] of this.activeOrders) {
      await this.cancelOrders(tokenId);
    }

    // Nettoyer l'inventaire
    this.inventory.cleanup();
    
    // Fermer proprement les connexions WebSocket
    this.feed.disconnect();
    if (this.userFeed) {
      this.userFeed.disconnect();
    }
    
    // Log final des métriques
    log.info("📊 Final PnL summary:");
    this.pnl.logMetrics();
  }

  /**
   * Ferme tous les ordres ouverts
   */
  async closeAllOrders(dryRun: boolean = false): Promise<void> {
    const result = await this.orderCloser.closeAllOrders(dryRun);
    
    if (result.success) {
      log.info({
        total: result.totalOrders,
        cancelled: result.cancelledOrders.length,
        failed: result.failedOrders.length
      }, "✅ All orders closed successfully");
    } else {
      log.error({
        total: result.totalOrders,
        cancelled: result.cancelledOrders.length,
        failed: result.failedOrders.length,
        errors: result.errors
      }, "❌ Some orders failed to close");
    }
  }

  /**
   * Ferme les ordres pour un token spécifique
   */
  async closeOrdersForToken(tokenId: string, dryRun: boolean = false): Promise<void> {
    const result = await this.orderCloser.closeOrdersForToken(tokenId, dryRun);
    
    if (result.success) {
      log.info({
        tokenId: tokenId.substring(0, 20) + '...',
        total: result.totalOrders,
        cancelled: result.cancelledOrders.length,
        failed: result.failedOrders.length
      }, "✅ Orders for token closed successfully");
    } else {
      log.error({
        tokenId: tokenId.substring(0, 20) + '...',
        total: result.totalOrders,
        cancelled: result.cancelledOrders.length,
        failed: result.failedOrders.length,
        errors: result.errors
      }, "❌ Some orders for token failed to close");
    }
  }

  /**
   * Retourne un résumé de l'inventaire
   */
  getInventorySummary(): any {
    return this.inventory.getSummary();
  }

  /**
   * Retourne l'inventaire pour un token spécifique
   */
  getInventoryForToken(tokenId: string): any {
    return this.inventory.getInventoryForToken(tokenId);
  }

  /**
   * Retourne un résumé des ordres ouverts
   */
  async getOrdersSummary(): Promise<any> {
    return await this.orderCloser.getOpenOrdersSummary();
  }

  /**
   * Force la mise à jour de l'allowance USDC
   */
  async updateUsdcAllowance(): Promise<boolean> {
    return await this.allowanceManager.forceUsdcCheck();
  }

  /**
   * Retourne le statut des allowances
   */
  getAllowanceStatus(): any {
    return this.allowanceManager.getSummary();
  }
}