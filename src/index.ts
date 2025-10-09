// src/index.ts - Point d'entrée principal du bot
import "dotenv/config";
import pino from "pino";
import { LOG_LEVEL } from "./config";

// Validation des variables d'environnement critiques
const REQUIRED = [
  "PRIVATE_KEY",
  "CLOB_API_KEY", 
  "CLOB_API_SECRET",
  "CLOB_PASSPHRASE",
  "POLY_PROXY_ADDRESS"
];

for (const k of REQUIRED) {
  if (!process.env[k]) {
    console.error(`❌ Missing required environment variable: ${k}`);
    process.exit(1);
  }
}

console.log("✅ ENV OK - All required environment variables are present");

export const rootLog = pino({
  level: LOG_LEVEL,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});
import { discoverLiveClobMarkets } from "./data/discovery";
import { snapshotTop } from "./data/book";
import { MarketMaker, MarketMakerConfig } from "./marketMaker";
import { ensureUsdcAllowance } from "./utils/approve";
import { 
  TARGET_SPREAD_CENTS, 
  TICK_IMPROVEMENT, 
  NOTIONAL_PER_ORDER_USDC, 
  MAX_ACTIVE_ORDERS, 
  REPLACE_COOLDOWN_MS, 
  DRY_RUN,
  MAX_INVENTORY,
  ALLOWANCE_THRESHOLD_USDC,
  MIN_SIZE_SHARES,
  MIN_NOTIONAL_USDC,
  MIN_SPREAD_MULTIPLIER,
  MAX_SPREAD_MULTIPLIER,
  AUTO_ADJUST_NOTIONAL,
  PRICE_CHANGE_THRESHOLD,
  MAX_DISTANCE_FROM_MID,
  MAX_ACTIVE_MARKETS,
  MIN_VOLUME_USDC
} from "./config";

const log = pino({ level: process.env.LOG_LEVEL || "info" });

async function main() {
  const MIN_VOL = MIN_VOLUME_USDC; // Utiliser la config centralisée
  const MAX = MAX_ACTIVE_MARKETS; // Utiliser la config centralisée

  log.info({ 
    DRY_RUN, 
    TARGET_SPREAD_CENTS, 
    NOTIONAL_PER_ORDER_USDC, 
    MAX_MARKETS: MAX 
  }, "🚀 Démarrage du Bot Market Maker Polymarket");

  // S'assurer que l'allowance USDC est suffisante
  // TODO: Implémenter l'approbation automatique avec le SDK officiel
  if (!DRY_RUN) {
    log.warn("⚠️ Approbation USDC manuelle requise - assurez-vous que le proxy a une allowance suffisante vers l'Exchange");
  }

  // Test de connexion CLOB avec CustomClobClient
  try {
    const { CustomClobClient } = await import("./clients/customClob");
    const clob = new CustomClobClient(
      process.env.PRIVATE_KEY!,
      process.env.CLOB_API_KEY!,
      process.env.CLOB_API_SECRET!,
      process.env.CLOB_PASSPHRASE!,
      undefined, // baseURL par défaut
      process.env.POLY_PROXY_ADDRESS // funderAddress = proxy avec les fonds USDC
    );
    log.info("✅ Connexion CLOB établie avec CustomClobClient");
  } catch (error) {
    log.error({ error }, "❌ Erreur de connexion CLOB");
    process.exit(1);
  }

  const mkts = await discoverLiveClobMarkets(200, MIN_VOL);
  if (mkts.length === 0) {
    log.error("🚨 0 marchés live détectés — vérifie tes endpoints et ton réseau (Gamma/CLOB)");
    process.exit(1);
  }
  
  // Tri intelligent : volume + spread + priorité Trump Nobel
  const picked = mkts
    .map(market => {
      // Calculer le spread pour chaque marché
      const spread = market.bestAskYes && market.bestBidYes 
        ? market.bestAskYes - market.bestBidYes 
        : 1.0; // Spread très large si pas de données
      
      // Score de priorité (plus élevé = meilleur)
      let priorityScore = 0;
      
      // Priorité Trump Nobel
      if (market.slug?.includes('trump') && market.slug?.includes('nobel')) {
        priorityScore += 1000;
      }
      
      // Score volume (normalisé)
      const volumeScore = Math.log10((market.volume24hrClob || 0) + 1) * 100;
      
      // Score spread (spread serré = meilleur)
      const spreadScore = Math.max(0, 100 - (spread * 10000)); // 0.001 = 90 points
      
      return {
        ...market,
        spread,
        totalScore: priorityScore + volumeScore + spreadScore
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore) // Tri décroissant par score
    .slice(0, MAX);
  log.info({ 
    selected: picked.length,
    markets: picked.map(m => ({ 
      slug: m.slug, 
      volume: m.volume24hrClob,
      spread: m.spread?.toFixed(4),
      score: m.totalScore?.toFixed(1)
    }))
  }, "📊 Marchés sélectionnés pour le market making");

  // Configuration du MarketMaker
  const mmConfig: MarketMakerConfig = {
    targetSpreadCents: TARGET_SPREAD_CENTS,
    tickImprovement: TICK_IMPROVEMENT,
    notionalPerOrderUsdc: NOTIONAL_PER_ORDER_USDC,
    maxActiveOrders: MAX_ACTIVE_ORDERS,
    replaceCooldownMs: REPLACE_COOLDOWN_MS,
    dryRun: DRY_RUN,
    maxInventory: MAX_INVENTORY,
    allowanceThresholdUsdc: ALLOWANCE_THRESHOLD_USDC,
    minSizeShares: MIN_SIZE_SHARES,
    minNotionalUsdc: MIN_NOTIONAL_USDC,
    minSpreadMultiplier: MIN_SPREAD_MULTIPLIER,
    maxSpreadMultiplier: MAX_SPREAD_MULTIPLIER,
    autoAdjustNotional: AUTO_ADJUST_NOTIONAL,
    priceChangeThreshold: PRICE_CHANGE_THRESHOLD,
    maxDistanceFromMid: MAX_DISTANCE_FROM_MID
  };

  // Démarrer le market making sur chaque marché sélectionné
  const marketMakers: MarketMaker[] = [];
  
  for (const market of picked) {
    log.info({ 
      market: market.slug, 
      volume: market.volume24hrClob,
      yesToken: market.yesTokenId.substring(0, 20) + '...',
      noToken: market.noTokenId.substring(0, 20) + '...'
    }, "🎯 Démarrer market making");

    const marketMaker = new MarketMaker(mmConfig);
    marketMakers.push(marketMaker);
    
    // Démarrer le market making (ne pas attendre)
    marketMaker.start(market).catch(error => {
      log.error({ error, market: market.slug }, "❌ Erreur dans le market making");
    });
  }

  log.info({ 
    activeMarketMakers: marketMakers.length,
    config: mmConfig 
  }, "✅ Market makers démarrés");

  // Gestion propre de l'arrêt
  process.on('SIGINT', async () => {
    log.info("🛑 Arrêt demandé, nettoyage en cours...");
    
    for (const mm of marketMakers) {
      await mm.stop();
    }
    
    log.info("👋 Bot arrêté proprement");
    process.exit(0);
  });
}

main().catch(e=>{ log.error(e); process.exit(1); });
