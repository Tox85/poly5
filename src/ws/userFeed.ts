// src/ws/userFeed.ts - WebSocket utilisateur pour recevoir les fills en temps réel
import WebSocket from "ws";
import crypto from "crypto";
import { rootLog } from "../index";
import { WSS_USER_URL } from "../config";

const log = rootLog.child({ name: "ws-user" });

export type FillEvent = {
  type: "fill";
  orderId: string;
  asset: string; // tokenId
  market: string;
  side: "BUY" | "SELL";
  price: string;
  size: string;
  fee?: string;
  timestamp: number;
  status: "MATCHED" | "LIVE" | "CANCELLED";
};

export type OrderEvent = {
  type: "order" | "order_status";
  orderId: string;
  status: "LIVE" | "MATCHED" | "CANCELLED" | "DELAYED";
  asset?: string;
  side?: "BUY" | "SELL";
  price?: string;
  originalSize?: string;
  sizeMatched?: string;
  timestamp: number;
};

export class UserFeed {
  private ws?: WebSocket;
  private ping?: NodeJS.Timeout;
  private reconnectTimeout?: NodeJS.Timeout;
  private fillListeners: Array<(fill: FillEvent) => void> = [];
  private orderListeners: Array<(order: OrderEvent) => void> = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private isConnecting = false;
  
  // ✅ FIX #9: Tracking des ordres locaux pour le mini-resync
  private localOrderIds = new Set<string>();
  private clobClient: any; // Référence au client CLOB pour les appels REST
  
  // Auth L2 comme pour REST API
  private apiKey: string;
  private apiSecret: string;
  private passphrase: string;
  private signingKey: string;

  constructor(apiKey: string, apiSecret: string, passphrase: string, signingKey: string, clobClient?: any) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.passphrase = passphrase;
    this.signingKey = signingKey;
    this.clobClient = clobClient; // ✅ FIX #9: Stocker la référence CLOB
  }

  /**
   * Connecte et s'authentifie au WebSocket utilisateur
   */
  connect() {
    if (this.isConnecting) {
      log.debug("User feed connection already in progress, skipping");
      return;
    }

    this.isConnecting = true;
    this.reconnectAttempts++;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    log.info({ 
      attempt: this.reconnectAttempts, 
      maxAttempts: this.maxReconnectAttempts,
      url: WSS_USER_URL 
    }, "Connecting to user WebSocket");

    // Générer headers d'authentification L2 (même logique que CustomClobClient)
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const method = "GET";
    const requestPath = "/ws/user";
    
    // HMAC: message = timestamp + method + requestPath
    const message = `${timestamp}${method}${requestPath}`;
    
    // Secret en Base64 → décoder avant de l'utiliser
    const key = Buffer.from(this.apiSecret, "base64");
    const hmac = crypto.createHmac("sha256", key);
    const sigB64 = hmac.update(message).digest("base64");
    
    // Base64 URL-safe (conserver les "=")
    const signature = sigB64.replace(/\+/g, "-").replace(/\//g, "_");

    this.ws = new WebSocket(WSS_USER_URL, {
      headers: {
        "POLY_ADDRESS": this.signingKey,
        "POLY_API_KEY": this.apiKey,
        "POLY_PASSPHRASE": this.passphrase,
        "POLY_TIMESTAMP": timestamp,
        "POLY_SIGNATURE": signature
      }
    });

    this.ws.on("open", () => {
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      
      log.info("✅ User WebSocket connected - ready to receive fills, orders, balance updates");
      
      // ✅ FIX #9: Mini-resync après reconnexion
      this.performMiniResync();
      
      // Ping périodique
      this.ping = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.ping();
        }
      }, 25_000); // Augmenté à 25s comme suggéré
    });

    this.ws.on("pong", () => {
      // Pong reçu, connexion OK
    });

    this.ws.on("message", (buf) => {
      try {
        const data = buf.toString();
        
        if (data === "PONG") {
          return;
        }
        
        const msg = JSON.parse(data);
        
        // Log tous les messages pour debug
        log.debug({
          event_type: msg.event_type,
          type: msg.type,
          message: JSON.stringify(msg)
        }, "🔍 UserFeed message received");
        
        // Fill event (ordre exécuté totalement ou partiellement)
        // ✅ FIX #8: Capturer aussi les événements "trade" qui contiennent les fills partiels
        if (msg.event_type === "match" || msg.type === "fill" || msg.event_type === "fill" || 
            msg.event_type === "trade" || msg.type === "trade") {
          const fill: FillEvent = {
            type: "fill",
            orderId: msg.order_id || msg.orderId,
            asset: msg.asset_id || msg.asset,
            market: msg.market,
            side: msg.side?.toUpperCase() as "BUY" | "SELL",
            price: msg.price,
            size: msg.size || msg.size_matched || msg.amount, // ✅ FIX: Essayer aussi msg.amount
            fee: msg.fee_rate_bps ? (parseFloat(msg.price) * parseFloat(msg.size || msg.amount || "0") * parseFloat(msg.fee_rate_bps) / 10000).toString() : "0",
            timestamp: msg.timestamp || Date.now(),
            status: "MATCHED"
          };
          
          // ✅ FIX #8: Valider que le fill a des données complètes
          if (!fill.orderId || !fill.asset || !fill.side || !fill.price || !fill.size) {
            log.warn({
              rawMessage: JSON.stringify(msg).substring(0, 200),
              reason: "Incomplete fill data"
            }, "⚠️ Skipping incomplete fill event");
            return;
          }
          
          log.info({
            event: "fill_detected",
            orderId: fill.orderId.substring(0, 16) + '...',
            side: fill.side,
            price: fill.price,
            size: fill.size,
            asset: fill.asset.substring(0, 20) + '...',
            timestamp: new Date(fill.timestamp).toISOString()
          }, "💰 FILL EVENT DETECTED");
          
          this.fillListeners.forEach(listener => listener(fill));
        }
        
        // Order status update (LIVE, CANCELLED, etc.)
        else if (msg.event_type === "order" || msg.type === "order") {
          const order: OrderEvent = {
            type: "order",
            orderId: msg.order_id || msg.orderId,
            status: msg.status?.toUpperCase() || "LIVE",
            asset: msg.asset_id || msg.asset,
            side: msg.side?.toUpperCase() as "BUY" | "SELL",
            price: msg.price,
            originalSize: msg.original_size || msg.size,
            sizeMatched: msg.size_matched,
            timestamp: msg.timestamp || Date.now()
          };
          
          log.info({
            orderId: order.orderId.substring(0, 16) + '...',
            status: order.status,
            side: order.side,
            price: order.price,
            size: order.originalSize
          }, `📋 ORDER ${order.status}`);
          
          this.orderListeners.forEach(listener => listener(order));
        }
      } catch (e) {
        log.warn({ e, data: buf.toString().substring(0, 100) }, "WS user parse error");
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
      }, "User WebSocket closed");

      // Reconnexion avec backoff exponentiel
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
        log.info({ delay, attempt: this.reconnectAttempts }, "Scheduling user WS reconnection");
        
        this.reconnectTimeout = setTimeout(() => {
          this.connect();
        }, delay);
      } else {
        log.error({ maxAttempts: this.maxReconnectAttempts }, "Max user WS reconnection attempts reached");
      }
    });

    this.ws.on("error", (err) => {
      this.isConnecting = false;
      log.error({ 
        err: {
          type: err.constructor.name,
          message: err.message,
          code: (err as any).code
        }
      }, "User WebSocket error");
    });
  }

  /**
   * Enregistre un listener pour les fills
   */
  onFill(listener: (fill: FillEvent) => void) {
    this.fillListeners.push(listener);
  }

  /**
   * Enregistre un listener pour les mises à jour d'ordres
   */
  onOrder(listener: (order: OrderEvent) => void) {
    this.orderListeners.push(listener);
  }

  /**
   * Ferme proprement la connexion
   */
  disconnect() {
    log.info("Disconnecting user WebSocket...");
    
    if (this.ping) {
      clearInterval(this.ping);
      this.ping = undefined;
    }
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, "Normal closure");
    }
    
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    log.info("User WebSocket disconnected");
  }

  /**
   * NOUVEAU : Ajoute un orderId au tracking local
   */
  addLocalOrderId(orderId: string) {
    this.localOrderIds.add(orderId);
  }

  /**
   * NOUVEAU : Retire un orderId du tracking local
   */
  removeLocalOrderId(orderId: string) {
    this.localOrderIds.delete(orderId);
  }

  /**
   * NOUVEAU : Mini-resync après reconnexion WebSocket
   * Vérifie le statut des ordres locaux via REST API
   */
  private async performMiniResync() {
    if (!this.clobClient || this.localOrderIds.size === 0) {
      return;
    }

    log.info({
      localOrderCount: this.localOrderIds.size
    }, "🔄 Performing mini-resync after WebSocket reconnection");

    try {
      // Récupérer les ordres ouverts depuis l'API REST
      const openOrders = await this.clobClient.getOpenOrders();
      
      if (!openOrders || openOrders.length === 0) {
        log.warn("🔄 No open orders from API during mini-resync");
        return;
      }

      const openOrderIds = new Set(openOrders.map((order: any) => order.id || order.orderId));

      // Vérifier chaque ordre local
      for (const localOrderId of this.localOrderIds) {
        if (openOrderIds.has(localOrderId)) {
          // Ordre toujours ouvert - émettre un événement LIVE
          this.orderListeners.forEach(listener => {
            listener({
              type: "order_status",
              orderId: localOrderId,
              status: "LIVE",
              timestamp: Date.now()
            });
          });
        } else {
          // Ordre fermé - émettre un événement CANCELLED
          this.orderListeners.forEach(listener => {
            listener({
              type: "order_status",
              orderId: localOrderId,
              status: "CANCELLED",
              timestamp: Date.now()
            });
          });
          this.localOrderIds.delete(localOrderId);
        }
      }

      log.info({
        syncedOrders: this.localOrderIds.size,
        totalOpenOrders: openOrders.length
      }, "✅ Mini-resync completed");

    } catch (error: any) {
      log.error({
        error: error.message,
        localOrderCount: this.localOrderIds.size
      }, "❌ Mini-resync failed");
    }
  }
}

