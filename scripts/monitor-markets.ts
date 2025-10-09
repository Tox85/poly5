#!/usr/bin/env tsx
// Script pour surveiller et filtrer les marchés actifs
import "dotenv/config";
import pino from "pino";
import { discoverLiveClobMarkets } from "../src/data/discovery";
import { snapshotTop } from "../src/data/book";
import { MIN_VOLUME_USDC, MAX_ACTIVE_MARKETS } from "../src/config";

const log = pino({ name: "monitor-markets" });

async function main() {
  log.info({ 
    minVolume: MIN_VOLUME_USDC, 
    maxMarkets: MAX_ACTIVE_MARKETS 
  }, "🔍 Recherche des marchés actifs...");

  // Découvrir tous les marchés actifs
  const allMarkets = await discoverLiveClobMarkets(200, MIN_VOLUME_USDC);

  log.info({ totalMarkets: allMarkets.length }, "📊 Marchés trouvés");

  if (allMarkets.length === 0) {
    log.warn("⚠️ Aucun marché trouvé avec le volume minimum requis");
    return;
  }

  // Afficher les détails des marchés
  console.log("\n=== MARCHÉS DISPONIBLES ===\n");

  for (let i = 0; i < Math.min(allMarkets.length, MAX_ACTIVE_MARKETS); i++) {
    const market = allMarkets[i];
    
    try {
      // Récupérer le carnet d'ordres pour YES et NO
      const yesBook = await snapshotTop(market.yesTokenId);
      const noBook = await snapshotTop(market.noTokenId);

      const yesSpread = (yesBook.bestBid && yesBook.bestAsk) 
        ? (yesBook.bestAsk - yesBook.bestBid).toFixed(4) 
        : "N/A";
      
      const noSpread = (noBook.bestBid && noBook.bestAsk) 
        ? (noBook.bestAsk - noBook.bestBid).toFixed(4) 
        : "N/A";

      const yesMid = (yesBook.bestBid && yesBook.bestAsk) 
        ? ((yesBook.bestBid + yesBook.bestAsk) / 2).toFixed(4) 
        : "N/A";
      
      const noMid = (noBook.bestBid && noBook.bestAsk) 
        ? ((noBook.bestBid + noBook.bestAsk) / 2).toFixed(4) 
        : "N/A";

      console.log(`${i + 1}. ${market.slug}`);
      console.log(`   Volume 24h: $${market.volume24hrClob?.toFixed(2) || "N/A"}`);
      console.log(`   YES - Mid: ${yesMid} | Spread: ${yesSpread} | Bid: ${yesBook.bestBid?.toFixed(4) || "N/A"} | Ask: ${yesBook.bestAsk?.toFixed(4) || "N/A"}`);
      console.log(`   NO  - Mid: ${noMid} | Spread: ${noSpread} | Bid: ${noBook.bestBid?.toFixed(4) || "N/A"} | Ask: ${noBook.bestAsk?.toFixed(4) || "N/A"}`);
      console.log("");

      // Petite pause pour éviter les rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      log.error({ error, slug: market.slug }, "❌ Erreur lors de la récupération des données du marché");
    }
  }

  console.log(`\n💡 Le bot sera lancé sur ${Math.min(allMarkets.length, MAX_ACTIVE_MARKETS)} marché(s)\n`);

  log.info("✅ Analyse terminée");
}

main().catch((error) => {
  log.error({ error }, "❌ Erreur fatale");
  process.exit(1);
});
