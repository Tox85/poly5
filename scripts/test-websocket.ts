// scripts/test-websocket.ts
import "dotenv/config";
import pino from "pino";
import { MarketFeed } from "../src/ws/marketFeed";

const log = pino({ name: "test-websocket" });

async function testWebSocket() {
  log.info("🚀 Démarrage des tests WebSocket...");

  const feed = new MarketFeed();
  let messageCount = 0;

  // Utiliser des tokenIds de test connus
  const tokenIds = [
    "110231926589098351804293174455681788984678095258631881563984268486591441074567", // YES Trump Nobel
    "7997695352317515524525062962990406756331391485123047293096327700752767906309"   // NO Trump Nobel
  ];

  feed.subscribe(tokenIds, (tokenId, bestBid, bestAsk) => {
    messageCount++;
    log.info({ messageCount, tokenId: tokenId.substring(0, 20) + '...', bestBid, bestAsk }, "📊 Prix reçu");
    if (messageCount > 5) { // Arrêter après quelques messages pour le test
      log.info("🛑 Arrêt demandé");
      feed.disconnect();
    }
  });

  // Attendre un peu pour observer les messages
  await new Promise(resolve => setTimeout(resolve, 10000)); // Attendre 10 secondes

  log.info("✅ Test WebSocket terminé.");
}

testWebSocket().catch(e => {
  log.error({ error: e.message, stack: e.stack }, "❌ Erreur dans le script de test WebSocket");
  process.exit(1);
});