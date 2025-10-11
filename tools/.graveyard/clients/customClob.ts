import axios, { AxiosInstance } from "axios";
import crypto from "crypto";
import { Wallet } from "ethers";
import { Wallet as V5Wallet } from "@ethersproject/wallet"; // Compatibilité ethers v5
import pino from "pino";
import { 
  ExchangeOrderBuilder, 
  SignatureType,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  ORDER_STRUCTURE
} from "@polymarket/order-utils";
import { EXCHANGE_ADDRESS, CHAIN_ID } from "../config";

const log = pino({ name: "custom-clob" });

export class CustomClobClient {
  private client: AxiosInstance;
  private wallet: Wallet;
  private apiKey: string;
  private apiSecret: string;
  private apiPassphrase: string;
  private address: string;
  private funderAddress?: string;
  private baseURL: string;

  constructor(
    privateKey: string,
    apiKey: string,
    apiSecret: string,
    apiPassphrase: string,
    baseURL: string = "https://clob.polymarket.com",
    funderAddress?: string
  ) {
    this.wallet = new Wallet(privateKey);
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.apiPassphrase = apiPassphrase;
    this.address = this.wallet.address;
    this.funderAddress = funderAddress;
    this.baseURL = baseURL;

    this.client = axios.create({
      baseURL,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "@polymarket/clob-client",
      },
    });

    // Interceptor pour ajouter l'authentification L2
    this.client.interceptors.request.use((config) => {
      const timestamp = Math.floor(Date.now() / 1000);
      const method = (config.method || "GET").toUpperCase();

      // Construire le requestPath (chemin + query), pas l'URL absolue
      // Assure que config.url est un chemin commençant par "/"
      const url = config.url || "/";
      let requestPath = url.startsWith("/") ? url : `/${url}`;

      // Corps (string) seulement si présent
      const body = config.data ? JSON.stringify(config.data) : undefined;

      // HMAC: message = timestamp + method + requestPath + (body si présent)
      let message = `${timestamp}${method}${requestPath}`;
      if (body !== undefined) message += body;

      // ⚠️ secret attendu en Base64 → décoder avant de l'utiliser
      const key = Buffer.from(this.apiSecret, "base64");
      const hmac = crypto.createHmac("sha256", key);
      const sigB64 = hmac.update(message).digest("base64");

      // Base64 URL-safe (conserver les "=")
      const sigUrlSafe = sigB64.replace(/\+/g, "-").replace(/\//g, "_");

      config.headers = {
        ...config.headers,
        "POLY_ADDRESS": this.address,           // EOA (jamais le proxy)
        "POLY_API_KEY": this.apiKey,
        "POLY_PASSPHRASE": this.apiPassphrase,
        "POLY_TIMESTAMP": timestamp,
        "POLY_SIGNATURE": sigUrlSafe,
      } as any;

      log.debug({ method, requestPath, timestamp }, "CLOB L2 auth headers");

      return config;
    });
  }

  // Méthode pour placer un ordre
  async postOrder(orderData: any): Promise<any> {
    try {
      // Signer l'ordre si nécessaire
      if (orderData.order && orderData.order.signature === "0x") {
        const signature = await this.signOrder(orderData.order);
        orderData.order.signature = signature;
      }

      const response = await this.client.post('/order', orderData);
      log.info({ orderId: response.data?.orderId }, "✅ Order placed successfully");
      return response.data;
    } catch (error: any) {
      log.error({ 
        error: error.response?.data || error.message,
        status: error.response?.status 
      }, "❌ Failed to place order");
      throw error;
    }
  }

  // Méthode pour signer un ordre avec EIP-712 (domaine et types officiels)
  private async signOrder(order: any): Promise<string> {
    try {
      // 1) Domain EIP-712 officiel avec les constantes Polymarket
      // IMPORTANT: verifyingContract doit être exactement 0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e pour Polygon
      const domain = {
        name: PROTOCOL_NAME,        // 'Polymarket CTF Exchange'
        version: PROTOCOL_VERSION,  // '1'
        chainId: CHAIN_ID,          // 137 pour Polygon
        verifyingContract: EXCHANGE_ADDRESS, // 0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e
      } as const;

      // 2) Types EIP-712 officiels avec l'ordre canonique des champs
      const types = { Order: ORDER_STRUCTURE } as const;

      // 3) Préparation des valeurs avec conversions correctes
      const expiration = order.expiration ?? '0';  // GTC = '0'
      const side = order.side === 'BUY' ? 0 : 1;   // string -> uint8 pour EIP-712
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

      const value = {
        salt: String(order.salt),                   // string pour EIP-712
        maker: order.maker,                         // address (proxy)
        signer: order.signer,                       // address (EOA)
        taker: order.taker ?? ZERO_ADDRESS,         // address
        tokenId: order.tokenId,                     // string
        makerAmount: order.makerAmount,             // string
        takerAmount: order.takerAmount,             // string
        expiration,                                 // string
        nonce: order.nonce ?? '0',                  // string
        feeRateBps: order.feeRateBps ?? '0',        // string
        side,                                       // number (uint8) pour EIP-712
        signatureType: order.signatureType,         // number (uint8) — 2 pour Safe
      };

      // 4) Signature EIP-712 avec ethers v6
      const signature = await this.wallet.signTypedData(domain, types, value);
      
      log.debug({ 
        domain, 
        orderFields: ORDER_STRUCTURE.map(f => f.name).join(', '),
        value: { ...value, salt: String(value.salt).substring(0, 20) + '...' } // Masquer le salt pour les logs
      }, "✅ Order signed successfully");
      
      return signature;
    } catch (error) {
      log.error({ error }, "❌ Failed to sign order");
      throw error;
    }
  }

  // Méthode pour annuler des ordres
  async cancelOrders(orderIds: string[]): Promise<any> {
    try {
      // Envoyer le tableau directement (pas d'enveloppe)
      const response = await this.client.delete('/orders', {
        data: orderIds   // 👈 tableau brut, pas { orderIds }
      });
      log.info({ cancelledCount: orderIds.length }, "✅ Orders cancelled successfully");
      return response.data;
    } catch (error: any) {
      log.error({ 
        error: error.response?.data || error.message,
        orderIds 
      }, "❌ Failed to cancel orders");
      throw error;
    }
  }

  // Méthode pour récupérer les ordres actifs
  async getOrders(params?: any): Promise<any> {
    try {
      // Doc: GET /<clob-endpoint>/data/orders (L2)
      const response = await this.client.get('/data/orders', { params: { status: 'OPEN', ...params } });
      return response.data;
    } catch (error: any) {
      log.error({ error: error.response?.data || error.message }, "❌ Failed to get open orders");
      throw error;
    }
  }

  // Récupérer balance + allowance
  async getBalances(): Promise<any> {
    try {
      // Par défaut: collatéral USDC
      const response = await this.client.get('/balance-allowance');
      return response.data;
    } catch (error: any) {
      log.error({ error: error.response?.data || error.message }, "❌ Failed to get balance-allowance");
      throw error;
    }
  }

  // Récupérer balance + allowance pour un asset spécifique (COLLATERAL ou CONDITIONAL)
  async getBalanceAllowance(params: {
    asset_type: "COLLATERAL" | "CONDITIONAL";
    token_id?: string; // requis pour CONDITIONAL
  }): Promise<{ balance: string; allowance: string }> {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('asset_type', params.asset_type);
      if (params.token_id) {
        queryParams.append('token_id', params.token_id);
      }
      
      const response = await this.client.get(`/balance-allowance?${queryParams.toString()}`);
      return response.data;
    } catch (error: any) {
      log.error({ 
        error: error.response?.data || error.message,
        params 
      }, "❌ Failed to get balance-allowance for asset");
      throw error;
    }
  }

  // Mettre à jour les allowances
  async updateBalanceAllowance(body: {
    asset_type: "COLLATERAL" | "CONDITIONAL";
    token_id?: string; // requis pour CONDITIONAL
  }): Promise<any> {
    try {
      const response = await this.client.post('/balance-allowance', body);
      return response.data;
    } catch (error: any) {
      log.error({ error: error.response?.data || error.message }, "❌ Failed to update balance-allowance");
      throw error;
    }
  }

  // Méthode pour récupérer l'orderbook
  async getOrderBook(tokenId: string): Promise<any> {
    try {
      const response = await this.client.get(`/book?token_id=${tokenId}`);
      return response.data;
    } catch (error: any) {
      log.error({ 
        error: error.response?.data || error.message,
        tokenId: tokenId.substring(0, 20) + '...'
      }, "❌ Failed to get orderbook");
      throw error;
    }
  }

  // Méthode publique pour obtenir l'adresse du wallet EOA
  getAddress(): string {
    return this.address;
  }

  // Méthode pour obtenir l'adresse maker (proxy pour les fonds)
  getMakerAddress(): string {
    return this.funderAddress || this.address;
  }
}
