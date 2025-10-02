// src/index.ts - Point d'entrée principal du bot
import "dotenv/config";
import pino from "pino";
import { discoverLiveClobMarkets } from "./data/discovery";
import { snapshotTop } from "./data/book";
import { MarketMaker, MarketMakerConfig } from "./marketMaker";
import { 
  TARGET_SPREAD_CENTS, 
  TICK_IMPROVEMENT, 
  NOTIONAL_PER_ORDER_USDC, 
  MAX_ACTIVE_ORDERS, 
  REPLACE_COOLDOWN_MS, 
  DRY_RUN 
} from "./config";

const log = pino({ level: process.env.LOG_LEVEL || "info" });

async function main() {
  const MIN_VOL = Number(process.env.MIN_24H_VOL_USDC || 1000);
  const MAX = Number(process.env.MAX_MARKETS || 2);

  log.info({ 
    DRY_RUN, 
    TARGET_SPREAD_CENTS, 
    NOTIONAL_PER_ORDER_USDC, 
    MAX_MARKETS: MAX 
  }, "🚀 Démarrage du Bot Market Maker Polymarket");

  // Test de connexion CLOB avec CustomClobClient
  try {
    const { CustomClobClient } = await import("./clients/customClob");
    const clob = new CustomClobClient(
      process.env.PRIVATE_KEY!,
      process.env.CLOB_API_KEY!,
      process.env.CLOB_API_SECRET!,
      process.env.CLOB_PASSPHRASE!
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
  
  // trie par volume puis coupe
  const picked = mkts.sort((a,b)=> (b.volume24hrClob||0)-(a.volume24hrClob||0)).slice(0, MAX);
  log.info({ 
    selected: picked.length,
    markets: picked.map(m => ({ slug: m.slug, volume: m.volume24hrClob }))
  }, "📊 Marchés sélectionnés pour le market making");

  // Configuration du MarketMaker
  const mmConfig: MarketMakerConfig = {
    targetSpreadCents: TARGET_SPREAD_CENTS,
    tickImprovement: TICK_IMPROVEMENT,
    notionalPerOrderUsdc: NOTIONAL_PER_ORDER_USDC,
    maxActiveOrders: MAX_ACTIVE_ORDERS,
    replaceCooldownMs: REPLACE_COOLDOWN_MS,
    dryRun: DRY_RUN
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
