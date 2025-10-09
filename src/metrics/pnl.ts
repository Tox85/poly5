// src/metrics/pnl.ts - Tracking PnL et métriques de trading
import fs from "fs";
import { rootLog } from "../index";
import { PNL_PERSISTENCE_FILE } from "../config";

const log = rootLog.child({ name: "pnl" });

export type Trade = {
  timestamp: number;
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  fee: number;
  orderId?: string;
  marketSlug?: string;
};

export type PnLSummary = {
  tokenId: string;
  realized: number;
  fees: number;
  tradeCount: number;
  buyVolume: number;
  sellVolume: number;
  avgBuyPrice: number;
  avgSellPrice: number;
};

export class PnLTracker {
  private trades: Trade[] = [];
  private file: string;

  constructor(file: string = PNL_PERSISTENCE_FILE) {
    this.file = file;
    this.loadFromFile();
  }

  /**
   * Charge les trades depuis le fichier de persistance
   */
  private loadFromFile() {
    try {
      if (fs.existsSync(this.file)) {
        const data = fs.readFileSync(this.file, "utf-8");
        this.trades = JSON.parse(data);
        log.info({ count: this.trades.length }, "📊 PnL history loaded from file");
      } else {
        log.info("📊 No PnL history file found, starting fresh");
      }
    } catch (error) {
      log.error({ error }, "❌ Failed to load PnL history");
      this.trades = [];
    }
  }

  /**
   * Sauvegarde les trades dans le fichier
   */
  private saveToFile() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.trades, null, 2));
      log.debug({ count: this.trades.length }, "💾 PnL saved to file");
    } catch (error) {
      log.error({ error }, "❌ Failed to save PnL");
    }
  }

  /**
   * Enregistre un nouveau trade (appelé depuis UserFeed lors d'un fill)
   */
  recordTrade(trade: Trade) {
    this.trades.push(trade);
    this.saveToFile();
    
    log.info({
      timestamp: new Date(trade.timestamp).toISOString(),
      tokenId: trade.tokenId.substring(0, 20) + '...',
      side: trade.side,
      price: trade.price.toFixed(4),
      size: trade.size.toFixed(2),
      notional: (trade.price * trade.size).toFixed(2),
      fee: trade.fee.toFixed(4),
      orderId: trade.orderId?.substring(0, 16) + '...'
    }, `💰 FILL ${trade.side}`);
  }

  /**
   * Calcule le PnL réalisé par token
   * Logique: Pour chaque token, somme(SELL notional) - somme(BUY notional) - somme(fees)
   */
  realizedPnl(): PnLSummary[] {
    const byToken = new Map<string, Trade[]>();
    
    // Grouper par token
    for (const trade of this.trades) {
      if (!byToken.has(trade.tokenId)) {
        byToken.set(trade.tokenId, []);
      }
      byToken.get(trade.tokenId)!.push(trade);
    }
    
    const summaries: PnLSummary[] = [];
    
    for (const [tokenId, trades] of byToken) {
      let buyNotional = 0;
      let sellNotional = 0;
      let totalFees = 0;
      let buyVolume = 0;
      let sellVolume = 0;
      let buyCount = 0;
      let sellCount = 0;
      
      for (const trade of trades) {
        const notional = trade.price * trade.size;
        totalFees += trade.fee;
        
        if (trade.side === "BUY") {
          buyNotional += notional;
          buyVolume += trade.size;
          buyCount++;
        } else {
          sellNotional += notional;
          sellVolume += trade.size;
          sellCount++;
        }
      }
      
      const realized = sellNotional - buyNotional - totalFees;
      const avgBuyPrice = buyVolume > 0 ? buyNotional / buyVolume : 0;
      const avgSellPrice = sellVolume > 0 ? sellNotional / sellVolume : 0;
      
      summaries.push({
        tokenId,
        realized,
        fees: totalFees,
        tradeCount: trades.length,
        buyVolume,
        sellVolume,
        avgBuyPrice,
        avgSellPrice
      });
    }
    
    return summaries;
  }

  /**
   * Calcule le spread capturé moyen sur les paires BUY/SELL
   * Pour chaque paire (BUY puis SELL du même token), calcule (sellPrice - buyPrice)
   */
  spreadCaptured(): number {
    const byToken = new Map<string, Trade[]>();
    
    for (const trade of this.trades) {
      if (!byToken.has(trade.tokenId)) {
        byToken.set(trade.tokenId, []);
      }
      byToken.get(trade.tokenId)!.push(trade);
    }
    
    let totalSpread = 0;
    let pairCount = 0;
    
    for (const [tokenId, trades] of byToken) {
      // Trier par timestamp
      const sorted = trades.sort((a, b) => a.timestamp - b.timestamp);
      
      // Trouver les paires BUY -> SELL
      let lastBuy: Trade | null = null;
      
      for (const trade of sorted) {
        if (trade.side === "BUY") {
          lastBuy = trade;
        } else if (trade.side === "SELL" && lastBuy) {
          // Paire trouvée
          const spread = trade.price - lastBuy.price;
          totalSpread += spread;
          pairCount++;
          lastBuy = null; // Reset pour la prochaine paire
        }
      }
    }
    
    return pairCount > 0 ? totalSpread / pairCount : 0;
  }

  /**
   * Retourne les statistiques globales
   */
  getGlobalStats() {
    const summaries = this.realizedPnl();
    
    let totalRealized = 0;
    let totalFees = 0;
    let totalTrades = 0;
    
    for (const summary of summaries) {
      totalRealized += summary.realized;
      totalFees += summary.fees;
      totalTrades += summary.tradeCount;
    }
    
    const avgSpread = this.spreadCaptured();
    
    return {
      totalRealized,
      totalFees,
      totalTrades,
      avgSpreadCaptured: avgSpread,
      tokenCount: summaries.length,
      summaries
    };
  }

  /**
   * Log les métriques (appelé périodiquement)
   */
  logMetrics() {
    const stats = this.getGlobalStats();
    
    log.info({
      totalRealized: stats.totalRealized.toFixed(4),
      totalFees: stats.totalFees.toFixed(4),
      netPnL: (stats.totalRealized - stats.totalFees).toFixed(4),
      totalTrades: stats.totalTrades,
      avgSpread: (stats.avgSpreadCaptured * 100).toFixed(2) + '¢',
      tokenCount: stats.tokenCount
    }, "📊 PnL METRICS");
    
    // Log détails par token
    for (const summary of stats.summaries) {
      log.info({
        tokenId: summary.tokenId.substring(0, 20) + '...',
        realized: summary.realized.toFixed(4),
        fees: summary.fees.toFixed(4),
        trades: summary.tradeCount,
        avgBuyPx: summary.avgBuyPrice.toFixed(4),
        avgSellPx: summary.avgSellPrice.toFixed(4),
        spread: ((summary.avgSellPrice - summary.avgBuyPrice) * 100).toFixed(2) + '¢'
      }, "  → Token PnL");
    }
  }

  /**
   * Nettoie les anciens trades (optionnel, pour éviter un fichier trop gros)
   */
  cleanup(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000) { // 7 jours par défaut
    const cutoff = Date.now() - maxAgeMs;
    const before = this.trades.length;
    this.trades = this.trades.filter(t => t.timestamp > cutoff);
    
    if (this.trades.length < before) {
      this.saveToFile();
      log.info({ removed: before - this.trades.length, kept: this.trades.length }, "🗑️ Old trades cleaned up");
    }
  }
}

