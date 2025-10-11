// src/ws/marketFeed.ts
import WebSocket from "ws";
import { rootLog } from "../index";
import { WSS_URL } from "../config";

const log = rootLog.child({ name: "ws" });

type PriceUpdate = { asset_id:string; best_bid?:string; best_ask?:string };

export class MarketFeed {
  private ws?: WebSocket;
  private ping?: NodeJS.Timeout;
  private reconnectTimeout?: NodeJS.Timeout;
  private listeners = new Map<string, (bb:number|null, ba:number|null)=>void>();
  // Cache des dernières valeurs price_change (source de vérité)
  private lastPrices = new Map<string, {bestBid: number|null, bestAsk: number|null}>();
  // Anti-spam pour les logs de prix
  private lastPriceLogs = new Map<string, {bid: number|null, ask: number|null}>();
  // Timestamp de la dernière mise à jour par token (pour détecter les marchés inactifs)
  private lastPriceUpdateTime = new Map<string, number>();
  private currentTokenIds: string[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private isConnecting = false;

  subscribe(tokenIds: string[], onUpdate: (tokenId:string, bb:number|null, ba:number|null)=>void) {
    // Ne PAS écraser les listeners existants, juste ajouter/mettre à jour
    tokenIds.forEach(t => {
      const existing = this.listeners.get(t);
      if (!existing) {
        this.listeners.set(t, (bb,ba)=>onUpdate(t,bb,ba));
        log.debug({ tokenId: t.substring(0, 20) + '...' }, "Listener added");
      } else {
        log.debug({ tokenId: t.substring(0, 20) + '...' }, "Listener already exists, keeping it");
      }
    });
    this.currentTokenIds = tokenIds;
    this.connect(tokenIds);
  }
  
  getLastPrices(tokenId: string): { bestBid: number|null, bestAsk: number|null } | null {
    return this.lastPrices.get(tokenId) || null;
  }

  /**
   * Vérifie si un token a reçu une mise à jour récente (dans les 5 minutes)
   * Retourne false si le marché semble inactif
   */
  isMarketActive(tokenId: string, maxAgeMs: number = 5 * 60 * 1000): boolean {
    const lastUpdate = this.lastPriceUpdateTime.get(tokenId);
    if (!lastUpdate) return false;
    
    const age = Date.now() - lastUpdate;
    return age < maxAgeMs;
  }

  private connect(tokenIds: string[]) {
    if (this.isConnecting) {
      log.debug("Connection already in progress, skipping");
      return;
    }

    this.isConnecting = true;
    this.reconnectAttempts++;

    // Nettoyer les timeouts précédents
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    log.info({ 
      attempt: this.reconnectAttempts, 
      maxAttempts: this.maxReconnectAttempts,
      url: WSS_URL 
    }, "Attempting WebSocket connection");

    this.ws = new WebSocket(WSS_URL);
    
    this.ws.on("open", () => {
      this.isConnecting = false;
      this.reconnectAttempts = 0; // Reset counter on successful connection
      
      // Attendre un peu que la connexion soit complètement établie
      setTimeout(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          // Format de souscription qui fonctionne selon nos tests
          const sub = { type: "MARKET", assets_ids: tokenIds };
          this.ws.send(JSON.stringify(sub));
          
          this.ping = setInterval(()=> {
            if (this.ws?.readyState === WebSocket.OPEN) {
              this.ws.ping();
            }
          }, 10_000);
          
          log.info({ tokenIds }, "WSS connected & subscribed");
        }
      }, 100);
    });

    this.ws.on("pong", () => {
      // Pong reçu, connexion OK
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
              
              // Mettre à jour le timestamp de dernière activité
              this.lastPriceUpdateTime.set(pc.asset_id, Date.now());
              
              // Notifier les listeners
              this.listeners.get(pc.asset_id)?.(bb,ba);
              
              // Log seulement si le prix a changé (anti-spam)
              const prev = this.lastPriceLogs.get(pc.asset_id);
              if (!prev || prev.bid !== bb || prev.ask !== ba) {
                log.debug({ asset_id: pc.asset_id, best_bid: bb, best_ask: ba }, "price update");
                this.lastPriceLogs.set(pc.asset_id, { bid: bb, ask: ba });
              }
            }
          } else if (msg.event_type === "book") {
            const asset = msg.asset_id;
            const bb = msg.bids?.length ? Number(msg.bids[0].price) : null;
            const ba = msg.asks?.length ? Number(msg.asks[0].price) : null;
            
            // FILTRE CRITIQUE: Ignorer les données book corrompues
            // Les données book avec bid=0.001 et ask=0.999 sont des valeurs par défaut incorrectes
            const isCorruptedData = (bb === 0.001 && ba === 0.999) || 
                                   (bb === 0.001 && ba === null) || 
                                   (bb === null && ba === 0.999);
            
            if (isCorruptedData) {
              log.warn({ 
                asset_id: asset, 
                best_bid: bb, 
                best_ask: ba, 
                reason: "Corrupted book data detected" 
              }, "Ignoring corrupted book snapshot");
              return;
            }
            
            // Seulement utiliser les données book si elles semblent valides
            if (bb !== null && ba !== null && bb < ba && bb > 0 && ba < 1) {
              const current = this.lastPrices.get(asset) || { bestBid: null, bestAsk: null };
              this.lastPrices.set(asset, { 
                bestBid: bb, 
                bestAsk: ba 
              });
              
              // Mettre à jour le timestamp de dernière activité
              this.lastPriceUpdateTime.set(asset, Date.now());
              
              this.listeners.get(asset)?.(bb, ba);
              log.info({ asset_id: asset, best_bid: bb, best_ask: ba, source: "book+validated" }, "book snapshot");
            } else {
              log.debug({ 
                asset_id: asset, 
                best_bid: bb, 
                best_ask: ba, 
                reason: "Invalid book data (bb >= ba or out of range)" 
              }, "Ignoring invalid book snapshot");
            }
          }
        } catch(e) { 
          log.warn({ e, data: buf.toString().substring(0, 100) }, "WS parse error"); 
        }
      });
    this.ws.on("close", (code, reason) => {
      this.isConnecting = false;
      clearInterval(this.ping!);
      
      log.warn({ 
        code, 
        reason: reason.toString(),
        attempt: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts
      }, "WebSocket connection closed");

      // Reconnexion avec backoff exponentiel
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
        log.info({ delay, attempt: this.reconnectAttempts }, "Scheduling reconnection");
        
        this.reconnectTimeout = setTimeout(() => {
          this.connect(this.currentTokenIds);
        }, delay);
      } else {
        log.error({ maxAttempts: this.maxReconnectAttempts }, "Max reconnection attempts reached");
      }
    });
    
    this.ws.on("error", (err) => {
      this.isConnecting = false;
      log.error({ 
        err: {
          type: err.constructor.name,
          message: err.message,
          errno: (err as any).errno,
          code: (err as any).code,
          syscall: (err as any).syscall,
          hostname: (err as any).hostname
        }
      }, "WSS error");
    });
  }

  /**
   * Ferme proprement la connexion WebSocket
   */
  disconnect() {
    log.info("Disconnecting WebSocket...");
    
    // Nettoyer tous les timeouts
    if (this.ping) {
      clearInterval(this.ping);
      this.ping = undefined;
    }
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
    
    // Fermer la connexion WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, "Normal closure");
    }
    
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    log.info("WebSocket disconnected");
  }
}
