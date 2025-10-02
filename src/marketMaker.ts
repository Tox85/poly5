// src/marketMaker.ts
import { CustomClobClient } from "./clients/customClob";
// Types locaux pour éviter l'import du SDK officiel
type OrderType = "GTC" | "IOC" | "FOK";
type Side = "BUY" | "SELL";
import { MarketFeed } from "./ws/marketFeed";
import pino from "pino";

const log = pino({ name: "mm" });

export type MarketMakerConfig = {
  targetSpreadCents: number;
  tickImprovement: number;
  notionalPerOrderUsdc: number;
  maxActiveOrders: number;
  replaceCooldownMs: number;
  dryRun: boolean;
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
  private activeOrders = new Map<string, { bidId?: string; askId?: string; bidPrice?: number; askPrice?: number }>();
  private lastReplaceTime = 0;
  private marketInfo: MarketInfo | null = null;

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
  }

  async start(market: MarketInfo) {
    this.marketInfo = market;
    log.info({ market: market.slug }, "🚀 Starting market making");

    // S'abonner aux mises à jour de prix temps réel
    this.feed.subscribe([market.yesTokenId, market.noTokenId], (tokenId, bestBid, bestAsk) => {
      this.handlePriceUpdate(tokenId, bestBid, bestAsk);
    });

    // Démarrer la logique de market making
    await this.initializeMarketMaking();
  }

  private async initializeMarketMaking() {
    if (!this.marketInfo) return;

    try {
      // Récupérer le snapshot initial
      const { snapshotTop } = await import("./data/book");
      const snapYes = await snapshotTop(this.marketInfo.yesTokenId);
      const snapNo = await snapshotTop(this.marketInfo.noTokenId);

      log.info({
        market: this.marketInfo.slug,
        snapYes: { bestBid: snapYes.bestBid, bestAsk: snapYes.bestAsk, tickSize: snapYes.tickSize },
        snapNo: { bestBid: snapNo.bestBid, bestAsk: snapNo.bestAsk, tickSize: snapNo.tickSize }
      }, "📊 Initial market snapshot");

      // Démarrer le market making sur le token Yes
      await this.startMarketMaking(this.marketInfo.yesTokenId, snapYes);
    } catch (error) {
      log.error({ error, market: this.marketInfo.slug }, "❌ Failed to initialize market making");
    }
  }

  private async startMarketMaking(tokenId: string, snapshot: any) {
    if (!snapshot.bestBid || !snapshot.bestAsk || !snapshot.tickSize) {
      log.warn({ tokenId, snapshot }, "⚠️ Incomplete snapshot data, skipping market making");
      return;
    }

    const spread = snapshot.bestAsk - snapshot.bestBid;
    const targetSpread = this.config.targetSpreadCents / 100; // Convertir centimes en dollars

    log.info({
      tokenId: tokenId.substring(0, 20) + '...',
      currentSpread: spread.toFixed(3),
      targetSpread: targetSpread.toFixed(3),
      tickSize: snapshot.tickSize
    }, "📈 Market making analysis");

    if (spread < targetSpread) {
      log.info({ currentSpread: spread, targetSpread }, "📉 Spread too tight, waiting for better opportunity");
      return;
    }

    await this.placeOrders(tokenId, snapshot);
  }

  private async handlePriceUpdate(tokenId: string, bestBid: number | null, bestAsk: number | null) {
    if (!bestBid || !bestAsk || !this.marketInfo) return;

    const currentOrders = this.activeOrders.get(tokenId);
    if (!currentOrders?.bidId || !currentOrders?.askId) {
      // Pas d'ordres actifs, essayer d'en placer
      await this.placeOrders(tokenId, { bestBid, bestAsk, tickSize: 0.001 });
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
        targetSpread: targetSpread.toFixed(3)
      }, "🔄 Replacing orders");
      
      await this.replaceOrders(tokenId, { bestBid, bestAsk, tickSize: 0.001 });
    }
  }

  private shouldReplaceOrders(currentOrders: any, bestBid: number, bestAsk: number, targetSpread: number): boolean {
    // Remplacer si nos ordres ne sont plus au top ou si le spread a changé significativement
    const ourBidIsBest = currentOrders.bidPrice && currentOrders.bidPrice >= bestBid;
    const ourAskIsBest = currentOrders.askPrice && currentOrders.askPrice <= bestAsk;
    
    return !ourBidIsBest || !ourAskIsBest || (bestAsk - bestBid) < targetSpread;
  }

  private canReplaceOrders(): boolean {
    const now = Date.now();
    if (now - this.lastReplaceTime < this.config.replaceCooldownMs) {
      return false;
    }
    this.lastReplaceTime = now;
    return true;
  }

  private async placeOrders(tokenId: string, snapshot: any) {
    if (this.config.dryRun) {
      log.info({ tokenId: tokenId.substring(0, 20) + '...', snapshot }, "🧪 DRY RUN: Would place orders");
      return;
    }

    let bidPrice: number = 0;
    let askPrice: number = 0;
    let size: number = 0;

    try {
      const prices = this.calculateOrderPrices(snapshot);
      bidPrice = prices.bidPrice;
      askPrice = prices.askPrice;
      size = this.calculateOrderSize(bidPrice);

      log.info({
        tokenId: tokenId.substring(0, 20) + '...',
        bidPrice: bidPrice.toFixed(3),
        askPrice: askPrice.toFixed(3),
        size: size.toFixed(3)
      }, "📝 Placing orders");

      // Construire l'ordre BUY complet
      const buyOrder = {
        deferExec: false,
        order: {
          salt: Math.floor(Math.random() * 1000000000000),
          maker: this.clob.getMakerAddress(), // Adresse proxy (fonds USDC)
          signer: this.clob.getAddress(), // Adresse EOA (authentification)
          taker: "0x0000000000000000000000000000000000000000",
          tokenId: tokenId,
          makerAmount: Math.floor(bidPrice * 1000000).toString(), // Prix en USDC (6 décimales)
          takerAmount: Math.floor(size * 1000000).toString(), // Taille en shares
          side: "BUY",
          expiration: "0",
          nonce: "0",
          feeRateBps: "0",
          signatureType: 0,
          signature: "0x" // Sera rempli par le client
        },
        owner: process.env.CLOB_API_KEY!,
        orderType: "GTC"
      };

      // Construire l'ordre SELL complet
      const sellOrder = {
        deferExec: false,
        order: {
          salt: Math.floor(Math.random() * 1000000000000),
          maker: this.clob.getMakerAddress(), // Adresse proxy (fonds USDC)
          signer: this.clob.getAddress(), // Adresse EOA (authentification)
          taker: "0x0000000000000000000000000000000000000000",
          tokenId: tokenId,
          makerAmount: Math.floor(askPrice * 1000000).toString(),
          takerAmount: Math.floor(size * 1000000).toString(),
          side: "SELL",
          expiration: "0",
          nonce: "0",
          feeRateBps: "0",
          signatureType: 0,
          signature: "0x"
        },
        owner: process.env.CLOB_API_KEY!,
        orderType: "GTC"
      };

      // Placer l'ordre BUY (bid)
      const buyResp = await this.clob.postOrder(buyOrder);

      // Placer l'ordre SELL (ask)
      const sellResp = await this.clob.postOrder(sellOrder);

      if (buyResp.success && sellResp.success) {
        this.activeOrders.set(tokenId, {
          bidId: buyResp.orderId || buyResp.orderID,
          askId: sellResp.orderId || sellResp.orderID,
          bidPrice,
          askPrice
        });

        log.info({
          tokenId: tokenId.substring(0, 20) + '...',
          bidId: buyResp.orderId || buyResp.orderID,
          askId: sellResp.orderId || sellResp.orderID
        }, "✅ Orders placed successfully");
      } else {
        log.error({
          tokenId: tokenId.substring(0, 20) + '...',
          buyResp,
          sellResp
        }, "❌ Failed to place orders");
      }

    } catch (error: any) {
      log.error({ 
        error: error?.message || error, 
        stack: error?.stack,
        tokenId: tokenId.substring(0, 20) + '...',
        bidPrice: bidPrice.toFixed(3),
        askPrice: askPrice.toFixed(3),
        size: size.toFixed(3)
      }, "❌ Error placing orders");
    }
  }

  private calculateOrderPrices(snapshot: any): { bidPrice: number; askPrice: number } {
    const midPrice = (snapshot.bestBid + snapshot.bestAsk) / 2;
    const targetSpread = this.config.targetSpreadCents / 100;
    const tickSize = snapshot.tickSize || 0.001;

    // Améliorer d'un tick par rapport au meilleur opposé
    const bidPrice = Math.max(
      snapshot.bestBid + (tickSize * this.config.tickImprovement),
      midPrice - (targetSpread / 2)
    );

    const askPrice = Math.min(
      snapshot.bestAsk - (tickSize * this.config.tickImprovement),
      midPrice + (targetSpread / 2)
    );

    // Arrondir au tick size
    const roundedBidPrice = Math.round(bidPrice / tickSize) * tickSize;
    const roundedAskPrice = Math.round(askPrice / tickSize) * tickSize;

    return {
      bidPrice: parseFloat(roundedBidPrice.toFixed(6)),
      askPrice: parseFloat(roundedAskPrice.toFixed(6))
    };
  }

  private calculateOrderSize(price: number): number {
    // Convertir USDC en nombre de shares
    return this.config.notionalPerOrderUsdc / price;
  }

  private async replaceOrders(tokenId: string, snapshot: any) {
    // Annuler les ordres existants
    await this.cancelOrders(tokenId);
    
    // Placer de nouveaux ordres
    await this.placeOrders(tokenId, snapshot);
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
    
    // Annuler tous les ordres actifs
    for (const [tokenId] of this.activeOrders) {
      await this.cancelOrders(tokenId);
    }
  }
}