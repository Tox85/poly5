// src/ws/marketFeed.ts
import WebSocket from "ws";
import pino from "pino";

const log = pino({ name: "ws" });
const WSS = process.env.WSS_URL || "wss://ws-subscriptions-clob.polymarket.com/ws/market";

type PriceUpdate = { asset_id:string; best_bid?:string; best_ask?:string };

export class MarketFeed {
  private ws?: WebSocket;
  private ping?: NodeJS.Timeout;
  private listeners = new Map<string, (bb:number|null, ba:number|null)=>void>();
  // Cache des dernières valeurs price_change (source de vérité)
  private lastPrices = new Map<string, {bestBid: number|null, bestAsk: number|null}>();

  subscribe(tokenIds: string[], onUpdate: (tokenId:string, bb:number|null, ba:number|null)=>void) {
    tokenIds.forEach(t => this.listeners.set(t, (bb,ba)=>onUpdate(t,bb,ba)));
    this.connect(tokenIds);
  }

  private connect(tokenIds: string[]) {
    this.ws = new WebSocket(WSS);
    this.ws.on("open", () => {
      // Attendre un peu que la connexion soit complètement établie
      setTimeout(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          // Format de souscription qui fonctionne selon nos tests
          const sub = { type: "MARKET", assets_ids: tokenIds };
          this.ws.send(JSON.stringify(sub));
          this.ping = setInterval(()=> {
            if (this.ws?.readyState === WebSocket.OPEN) {
              this.ws.send("PING");
            }
          }, 10_000);
          log.info({ tokenIds }, "WSS connected & subscribed");
        }
      }, 100);
    });
      this.ws.on("message", (buf) => {
        try {
          const data = buf.toString();
          
          // Gérer les messages PONG
          if (data === "PONG") {
            return;
          }
          
          const msg = JSON.parse(data);
          
          // Gérer les messages de marché (format observé dans nos tests)
          if (msg.market && msg.price_changes && Array.isArray(msg.price_changes)) {
            for (const pc of msg.price_changes as PriceUpdate[]) {
              const bb = pc.best_bid != null ? Number(pc.best_bid) : null;
              const ba = pc.best_ask != null ? Number(pc.best_ask) : null;
              
              // Mettre à jour le cache (source de vérité)
              this.lastPrices.set(pc.asset_id, { bestBid: bb, bestAsk: ba });
              
              // Notifier les listeners
              this.listeners.get(pc.asset_id)?.(bb,ba);
              log.info({ asset_id: pc.asset_id, best_bid: bb, best_ask: ba }, "price update");
            }
          } else if (msg.event_type === "book") {
            const asset = msg.asset_id;
            // Le book sert seulement pour snapshot/resync, pas pour remplacer price_change
            const bb = msg.bids?.length ? Number(msg.bids[0].price) : null;
            const ba = msg.asks?.length ? Number(msg.asks[0].price) : null;
            
            // Seulement mettre à jour le cache si on a de vraies données
            if (bb !== null || ba !== null) {
              const current = this.lastPrices.get(asset) || { bestBid: null, bestAsk: null };
              this.lastPrices.set(asset, { 
                bestBid: bb !== null ? bb : current.bestBid, 
                bestAsk: ba !== null ? ba : current.bestAsk 
              });
              
              // Utiliser les valeurs mises à jour (book + cache price_change)
              const finalBid = bb !== null ? bb : current.bestBid;
              const finalAsk = ba !== null ? ba : current.bestAsk;
              
              this.listeners.get(asset)?.(finalBid, finalAsk);
              log.info({ asset_id: asset, best_bid: finalBid, best_ask: finalAsk, source: "book+cache" }, "book snapshot");
            }
          }
        } catch(e) { 
          log.warn({ e, data: buf.toString().substring(0, 100) }, "WS parse error"); 
        }
      });
    this.ws.on("close", () => {
      clearInterval(this.ping!);
      setTimeout(()=> this.connect(tokenIds), Number(process.env.WS_RECONNECT_MS || 2000));
    });
    this.ws.on("error", (err)=> log.error({ err }, "WSS error"));
  }
}
