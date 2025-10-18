// Order Manager - Gestion des ordres (un seul actif par marché, side-lock, replace logic)
import pino from "pino";
import { PolyClobClient } from "../clients/polySDK";
import { buildAmounts, quantize } from "../lib/amounts";
import { SignatureType } from "@polymarket/order-utils";
import {
  ORDER_TTL_MS,
  REPLACE_PRICE_TICKS,
  ASK_CHASE_WINDOW_SEC,
  ASK_CHASE_MAX_REPLACES,
  DEFAULT_TICK_SIZE,
  DRY_RUN
} from "../config";

const log = pino({ name: "order" });

type OrderType = "GTC" | "IOC" | "FOK";
type Side = "BUY" | "SELL";

export type ActiveOrder = {
  orderId: string;
  tokenId: string;
  side: Side;
  price: number;
  size: number;
  placedAt: number;
  lastBestBid?: number;
  lastBestAsk?: number;
};

/**
 * Construit un ordre Polymarket avec les bons montants quantifiés
 */
function buildOrder(
  side: Side,
  tokenId: string,
  price: number,
  size: number,
  maker: string,
  signer: string
) {
  const { makerAmount, takerAmount } = buildAmounts(side, price, size);
  const uniqueSalt = Date.now() * 1000 + Math.floor(Math.random() * 1000);

  return {
    salt: uniqueSalt,
    maker,
    signer,
    taker: "0x0000000000000000000000000000000000000000",
    tokenId,
    makerAmount: makerAmount.toString(),
    takerAmount: takerAmount.toString(),
    side,
    expiration: "0",
    nonce: "0",
    feeRateBps: "0",
    signatureType: SignatureType.EOA
  };
}

export class OrderManager {
  private clob: PolyClobClient;
  
  // Un seul ordre actif par tokenId (side-lock)
  private activeOrders = new Map<string, ActiveOrder>();

  constructor(clob: PolyClobClient) {
    this.clob = clob;
    log.info("📋 Order Manager initialized");
  }

  /**
   * Calcule le prix optimal pour passer devant la file
   */
  stepAheadPrice(side: Side, bestBid: number, bestAsk: number, tick: number): number {
    if (side === "BUY") {
      // BUY: améliorer d'1 tick au-dessus du best bid, sans croiser le ask
      return Math.min(bestAsk - tick, bestBid + tick);
    } else {
      // SELL: améliorer d'1 tick en-dessous du best ask, sans croiser le bid
      return Math.max(bestBid + tick, bestAsk - tick);
    }
  }

  /**
   * Place un ordre BUY au best bid
   */
  async placeBuy(
    tokenId: string,
    bestBid: number,
    bestAsk: number,
    size: number,
    tick: number = DEFAULT_TICK_SIZE,
    minSize: number = 1.0
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    try {
      // Vérifier qu'il n'y a pas déjà un ordre actif
      if (this.activeOrders.has(tokenId)) {
        const existing = this.activeOrders.get(tokenId)!;
        log.warn({
          tokenId: tokenId.substring(0, 20) + '...',
          existingOrderId: existing.orderId.substring(0, 16) + '...',
          existingSide: existing.side
        }, "⚠️ Cannot place BUY: order already active (side-lock)");
        return { success: false, error: "order_already_active" };
      }

      // Quantiser prix et taille selon le tick et minSize
      const { price: qPrice, size: qSize } = quantize(bestBid, size, tick, minSize);
      
      // Vérifier que le prix quantifié est valide
      if (qPrice >= bestAsk) {
        log.warn({
          tokenId: tokenId.substring(0, 20) + '...',
          originalPrice: bestBid.toFixed(4),
          quantizedPrice: qPrice.toFixed(4),
          bestAsk: bestAsk.toFixed(4),
          tick: tick.toFixed(4)
        }, "⚠️ Would cross after quantization");
        return { success: false, error: "would_cross_after_quantization" };
      }

      // Vérifier que la taille respecte le minSize
      if (qSize < minSize) {
        log.warn({
          tokenId: tokenId.substring(0, 20) + '...',
          originalSize: size,
          quantizedSize: qSize,
          minSize,
          tick: tick.toFixed(4)
        }, "⚠️ Size below minimum after quantization");
        return { success: false, error: "size_below_minimum" };
      }

      const price = qPrice;
      const finalSize = qSize;

      // Post-only check: s'assurer qu'on ne croise pas
      if (price >= bestAsk) {
        log.warn({
          tokenId: tokenId.substring(0, 20) + '...',
          price: price.toFixed(4),
          bestAsk: bestAsk.toFixed(4)
        }, "⚠️ Would cross: BUY price >= best ask");
        return { success: false, error: "would_cross" };
      }

      // Construire l'ordre
      const maker = this.clob.getMakerAddress();
      const signer = this.clob.getAddress();
      const orderData = buildOrder("BUY", tokenId, price, finalSize, maker, signer);

      const order = {
        deferExec: false,
        order: { ...orderData, signature: "0x" },
        owner: process.env.CLOB_API_KEY!,
        orderType: "GTC" as OrderType
      };

      log.info({
        tokenId: tokenId.substring(0, 20) + '...',
        side: "BUY",
        price: price.toFixed(4),
        size: finalSize,
        notional: (price * finalSize).toFixed(2),
        bestBid: bestBid.toFixed(4),
        bestAsk: bestAsk.toFixed(4),
        tick: tick.toFixed(4),
        minSize
      }, "📤 Placing BUY order (quantized)");

      if (DRY_RUN) {
        log.info("🔵 DRY RUN: BUY order NOT placed");
        return { success: true, orderId: "dry-run-" + Date.now() };
      }

      const resp = await this.clob.postOrder(order);

      if (resp.success && (resp.orderId || resp.orderID)) {
        const orderId = resp.orderId || resp.orderID;

        // Enregistrer l'ordre actif
        this.activeOrders.set(tokenId, {
          orderId,
          tokenId,
          side: "BUY",
          price,
          size: finalSize,
          placedAt: Date.now(),
          lastBestBid: bestBid,
          lastBestAsk: bestAsk
        });

        log.info({
          tokenId: tokenId.substring(0, 20) + '...',
          orderId: orderId.substring(0, 16) + '...',
          side: "BUY",
          price: price.toFixed(4),
          size
        }, "✅ BUY order placed");

        return { success: true, orderId };
      } else {
        log.error({
          tokenId: tokenId.substring(0, 20) + '...',
          response: resp
        }, "❌ BUY order failed");
        return { success: false, error: "api_error" };
      }
    } catch (error: any) {
      log.error({
        tokenId: tokenId.substring(0, 20) + '...',
        error: error.message
      }, "❌ Error placing BUY order");
      return { success: false, error: error.message };
    }
  }

  /**
   * Place un ordre SELL au best ask
   */
  async placeSell(
    tokenId: string,
    bestBid: number,
    bestAsk: number,
    size: number,
    tick: number = DEFAULT_TICK_SIZE,
    minSize: number = 1.0
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    try {
      // Vérifier qu'il n'y a pas déjà un ordre actif
      if (this.activeOrders.has(tokenId)) {
        const existing = this.activeOrders.get(tokenId)!;
        log.warn({
          tokenId: tokenId.substring(0, 20) + '...',
          existingOrderId: existing.orderId.substring(0, 16) + '...',
          existingSide: existing.side
        }, "⚠️ Cannot place SELL: order already active (side-lock)");
        return { success: false, error: "order_already_active" };
      }

      // Quantiser prix et taille selon le tick et minSize
      const { price: qPrice, size: qSize } = quantize(bestAsk, size, tick, minSize);
      
      // Vérifier que le prix quantifié est valide
      if (qPrice <= bestBid) {
        log.warn({
          tokenId: tokenId.substring(0, 20) + '...',
          originalPrice: bestAsk.toFixed(4),
          quantizedPrice: qPrice.toFixed(4),
          bestBid: bestBid.toFixed(4),
          tick: tick.toFixed(4)
        }, "⚠️ Would cross after quantization");
        return { success: false, error: "would_cross_after_quantization" };
      }

      // Vérifier que la taille respecte le minSize
      if (qSize < minSize) {
        log.warn({
          tokenId: tokenId.substring(0, 20) + '...',
          originalSize: size,
          quantizedSize: qSize,
          minSize,
          tick: tick.toFixed(4)
        }, "⚠️ Size below minimum after quantization");
        return { success: false, error: "size_below_minimum" };
      }

      const price = qPrice;
      const finalSize = qSize;

      // Post-only check: s'assurer qu'on ne croise pas
      if (price <= bestBid) {
        log.warn({
          tokenId: tokenId.substring(0, 20) + '...',
          price: price.toFixed(4),
          bestBid: bestBid.toFixed(4)
        }, "⚠️ Would cross: SELL price <= best bid");
        return { success: false, error: "would_cross" };
      }

      // Construire l'ordre
      const maker = this.clob.getMakerAddress();
      const signer = this.clob.getAddress();
      const orderData = buildOrder("SELL", tokenId, price, finalSize, maker, signer);

      const order = {
        deferExec: false,
        order: { ...orderData, signature: "0x" },
        owner: process.env.CLOB_API_KEY!,
        orderType: "GTC" as OrderType
      };

      log.info({
        tokenId: tokenId.substring(0, 20) + '...',
        side: "SELL",
        price: price.toFixed(4),
        size: finalSize,
        notional: (price * finalSize).toFixed(2),
        bestBid: bestBid.toFixed(4),
        bestAsk: bestAsk.toFixed(4),
        tick: tick.toFixed(4),
        minSize
      }, "📤 Placing SELL order (quantized)");

      if (DRY_RUN) {
        log.info("🔵 DRY RUN: SELL order NOT placed");
        return { success: true, orderId: "dry-run-" + Date.now() };
      }

      const resp = await this.clob.postOrder(order);

      if (resp.success && (resp.orderId || resp.orderID)) {
        const orderId = resp.orderId || resp.orderID;

        // Enregistrer l'ordre actif
        this.activeOrders.set(tokenId, {
          orderId,
          tokenId,
          side: "SELL",
          price,
          size: finalSize,
          placedAt: Date.now(),
          lastBestBid: bestBid,
          lastBestAsk: bestAsk
        });

        log.info({
          tokenId: tokenId.substring(0, 20) + '...',
          orderId: orderId.substring(0, 16) + '...',
          side: "SELL",
          price: price.toFixed(4),
          size
        }, "✅ SELL order placed");

        return { success: true, orderId };
      } else {
        log.error({
          tokenId: tokenId.substring(0, 20) + '...',
          response: resp
        }, "❌ SELL order failed");
        return { success: false, error: "api_error" };
      }
    } catch (error: any) {
      log.error({
        tokenId: tokenId.substring(0, 20) + '...',
        error: error.message
      }, "❌ Error placing SELL order");
      return { success: false, error: error.message };
    }
  }

  /**
   * Replace un ordre BUY existant (cancel puis place)
   */
  async replaceBuy(
    tokenId: string,
    newBestBid: number,
    newBestAsk: number
  ): Promise<{ success: boolean; orderId?: string }> {
    const existing = this.activeOrders.get(tokenId);
    if (!existing || existing.side !== "BUY") {
      log.warn({ tokenId: tokenId.substring(0, 20) + '...' }, "No BUY order to replace");
      return { success: false };
    }

    // Récupérer le tick dynamique (utiliser DEFAULT_TICK_SIZE en fallback)
    const tick = DEFAULT_TICK_SIZE; // TODO: récupérer depuis marketFeed
    
    // Vérifier si le prix a changé suffisamment (REPLACE_PRICE_TICKS)
    const priceDiff = Math.abs(newBestBid - existing.price);
    if (priceDiff < REPLACE_PRICE_TICKS * tick) {
      log.debug({
        tokenId: tokenId.substring(0, 20) + '...',
        oldPrice: existing.price.toFixed(4),
        newPrice: newBestBid.toFixed(4),
        diff: priceDiff.toFixed(4),
        threshold: (REPLACE_PRICE_TICKS * tick).toFixed(4),
        tick: tick.toFixed(4)
      }, "Price change too small for replace");
      return { success: false };
    }

    log.info({
      tokenId: tokenId.substring(0, 20) + '...',
      oldOrderId: existing.orderId.substring(0, 16) + '...',
      oldPrice: existing.price.toFixed(4),
      newPrice: newBestBid.toFixed(4)
    }, "🔄 Replacing BUY order");

    // Cancel puis place
    await this.cancelOrder(tokenId);
    return await this.placeBuy(tokenId, newBestBid, newBestAsk, existing.size, tick, 1.0);
  }

  /**
   * Replace un ordre SELL existant (cancel puis place) - Ask Chase
   */
  async replaceSell(
    tokenId: string,
    newBestBid: number,
    newBestAsk: number
  ): Promise<{ success: boolean; orderId?: string }> {
    const existing = this.activeOrders.get(tokenId);
    if (!existing || existing.side !== "SELL") {
      log.warn({ tokenId: tokenId.substring(0, 20) + '...' }, "No SELL order to replace");
      return { success: false };
    }

    // Récupérer le tick dynamique (utiliser DEFAULT_TICK_SIZE en fallback)
    const tick = DEFAULT_TICK_SIZE; // TODO: récupérer depuis marketFeed
    
    // Vérifier si le prix a changé suffisamment
    const priceDiff = Math.abs(newBestAsk - existing.price);
    if (priceDiff < REPLACE_PRICE_TICKS * tick) {
      log.debug({
        tokenId: tokenId.substring(0, 20) + '...',
        oldPrice: existing.price.toFixed(4),
        newPrice: newBestAsk.toFixed(4),
        diff: priceDiff.toFixed(4),
        threshold: (REPLACE_PRICE_TICKS * tick).toFixed(4),
        tick: tick.toFixed(4)
      }, "Price change too small for replace");
      return { success: false };
    }

    log.info({
      tokenId: tokenId.substring(0, 20) + '...',
      oldOrderId: existing.orderId.substring(0, 16) + '...',
      oldPrice: existing.price.toFixed(4),
      newPrice: newBestAsk.toFixed(4)
    }, "🔄 Replacing SELL order (ask chase)");

    // Cancel puis place
    await this.cancelOrder(tokenId);
    return await this.placeSell(tokenId, newBestBid, newBestAsk, existing.size, tick, 1.0);
  }

  /**
   * Annule un ordre actif
   */
  async cancelOrder(tokenId: string): Promise<boolean> {
    const order = this.activeOrders.get(tokenId);
    if (!order) {
      log.debug({ tokenId: tokenId.substring(0, 20) + '...' }, "No active order to cancel");
      return false;
    }

    try {
      log.info({
        tokenId: tokenId.substring(0, 20) + '...',
        orderId: order.orderId.substring(0, 16) + '...',
        side: order.side
      }, "🗑️ Canceling order");

      if (DRY_RUN) {
        log.info("🔵 DRY RUN: Order NOT cancelled");
        this.activeOrders.delete(tokenId);
        return true;
      }

      const resp = await this.clob.cancelOrders([order.orderId]);

      if (resp) {
        this.activeOrders.delete(tokenId);
        log.info({
          tokenId: tokenId.substring(0, 20) + '...',
          orderId: order.orderId.substring(0, 16) + '...'
        }, "✅ Order cancelled");
        return true;
      }

      return false;
    } catch (error: any) {
      log.error({
        tokenId: tokenId.substring(0, 20) + '...',
        error: error.message
      }, "❌ Error canceling order");
      return false;
    }
  }

  /**
   * Vérifie si un ordre BUY doit être replacé (TTL ou prix changé)
   */
  shouldReplaceBuy(tokenId: string, currentBestBid: number, currentBestAsk: number): boolean {
    const order = this.activeOrders.get(tokenId);
    if (!order || order.side !== "BUY") return false;

    // TTL expiré
    const age = Date.now() - order.placedAt;
    if (age > ORDER_TTL_MS) {
      log.debug({
        tokenId: tokenId.substring(0, 20) + '...',
        age: (age / 1000).toFixed(1) + 's',
        ttl: (ORDER_TTL_MS / 1000).toFixed(1) + 's'
      }, "⏰ BUY order TTL expired");
      return true;
    }

    // Prix changé significativement
    const tick = DEFAULT_TICK_SIZE; // TODO: récupérer depuis marketFeed
    const priceDiff = Math.abs(currentBestBid - order.price);
    if (priceDiff >= REPLACE_PRICE_TICKS * tick) {
      log.debug({
        tokenId: tokenId.substring(0, 20) + '...',
        oldPrice: order.price.toFixed(4),
        newPrice: currentBestBid.toFixed(4),
        diff: priceDiff.toFixed(4),
        tick: tick.toFixed(4)
      }, "💹 BUY price changed significantly");
      return true;
    }

    return false;
  }

  /**
   * Vérifie si un ordre SELL doit être replacé (TTL ou prix changé)
   * Utilisé en WAIT_SELL_FILL pour replace continu
   */
  shouldReplaceSell(tokenId: string, currentBestBid: number, currentBestAsk: number): boolean {
    const order = this.activeOrders.get(tokenId);
    if (!order || order.side !== "SELL") return false;

    // TTL expiré
    const age = Date.now() - order.placedAt;
    if (age > ORDER_TTL_MS) {
      log.debug({
        tokenId: tokenId.substring(0, 20) + '...',
        age: (age / 1000).toFixed(1) + 's',
        ttl: (ORDER_TTL_MS / 1000).toFixed(1) + 's'
      }, "⏰ SELL order TTL expired");
      return true;
    }

    // Prix changé significativement
    const tick = DEFAULT_TICK_SIZE; // TODO: récupérer depuis marketFeed
    const priceDiff = Math.abs(currentBestAsk - order.price);
    if (priceDiff >= REPLACE_PRICE_TICKS * tick) {
      log.debug({
        tokenId: tokenId.substring(0, 20) + '...',
        oldPrice: order.price.toFixed(4),
        newPrice: currentBestAsk.toFixed(4),
        diff: priceDiff.toFixed(4),
        tick: tick.toFixed(4)
      }, "💹 SELL price changed significantly");
      return true;
    }

    return false;
  }

  /**
   * Vérifie si on est dans la fenêtre ask chase et si on peut encore replace
   */
  canAskChase(tokenId: string, replaceCount: number): boolean {
    const order = this.activeOrders.get(tokenId);
    if (!order || order.side !== "SELL") return false;

    const age = Date.now() - order.placedAt;
    const windowMs = ASK_CHASE_WINDOW_SEC * 1000;

    // Fenêtre expirée
    if (age > windowMs) {
      log.debug({
        tokenId: tokenId.substring(0, 20) + '...',
        age: (age / 1000).toFixed(1) + 's',
        window: ASK_CHASE_WINDOW_SEC + 's'
      }, "⏰ Ask chase window expired");
      return false;
    }

    // Max replaces atteint
    if (replaceCount >= ASK_CHASE_MAX_REPLACES) {
      log.debug({
        tokenId: tokenId.substring(0, 20) + '...',
        replaceCount,
        max: ASK_CHASE_MAX_REPLACES
      }, "🚫 Ask chase max replaces reached");
      return false;
    }

    return true;
  }

  /**
   * Retourne l'ordre actif pour un tokenId
   */
  getActiveOrder(tokenId: string): ActiveOrder | undefined {
    return this.activeOrders.get(tokenId);
  }

  /**
   * Supprime un ordre actif (utilisé quand un fill est reçu)
   */
  removeActiveOrder(tokenId: string) {
    this.activeOrders.delete(tokenId);
    log.debug({ tokenId: tokenId.substring(0, 20) + '...' }, "🗑️ Active order removed");
  }

  /**
   * Log les ordres actifs
   */
  logActiveOrders() {
    const orders = Array.from(this.activeOrders.values());

    log.info({
      totalOrders: orders.length,
      orders: orders.map(o => ({
        tokenId: o.tokenId.substring(0, 20) + '...',
        orderId: o.orderId.substring(0, 16) + '...',
        side: o.side,
        price: o.price.toFixed(4),
        size: o.size,
        age: ((Date.now() - o.placedAt) / 1000).toFixed(1) + 's'
      }))
    }, "📋 Active orders");
  }
}

