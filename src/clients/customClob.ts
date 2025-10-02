import axios, { AxiosInstance } from "axios";
import crypto from "crypto";
import { Wallet } from "ethers";
import pino from "pino";

const log = pino({ name: "custom-clob" });

export class CustomClobClient {
  private client: AxiosInstance;
  private wallet: Wallet;
  private apiKey: string;
  private apiSecret: string;
  private apiPassphrase: string;
  private address: string;
  private funderAddress?: string;

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

    this.client = axios.create({
      baseURL,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "@polymarket/clob-client",
      },
    });

    // Interceptor pour ajouter l'authentification L2
    this.client.interceptors.request.use((config) => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      
      // Générer la signature HMAC correcte selon la documentation Polymarket
      // Format: timestamp + method + url + body
      const body = config.data ? JSON.stringify(config.data) : '';
      const message = timestamp + config.method?.toUpperCase() + (config.url || '') + body;
      const signature = crypto
        .createHmac('sha256', this.apiSecret)
        .update(message)
        .digest('base64');

      config.headers = {
        ...config.headers,
        'POLY_ADDRESS': this.address,
        'POLY_API_KEY': this.apiKey,
        'POLY_PASSPHRASE': this.apiPassphrase,
        'POLY_TIMESTAMP': timestamp,
        'POLY_SIGNATURE': signature,
      } as any;

      log.debug({
        url: config.url,
        method: config.method,
        timestamp,
        address: this.address,
        apiKey: this.apiKey.substring(0, 8) + '...'
      }, "CLOB request with L2 auth");

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

  // Méthode pour signer un ordre
  private async signOrder(order: any): Promise<string> {
    // Structure de domaine pour la signature EIP-712
    const domain = {
      name: "Polymarket",
      version: "1",
      chainId: 137, // Polygon
      verifyingContract: "0x0000000000000000000000000000000000000000"
    };

    const types = {
      Order: [
        { name: "salt", type: "uint256" },
        { name: "maker", type: "address" },
        { name: "signer", type: "address" },
        { name: "taker", type: "address" },
        { name: "tokenId", type: "uint256" },
        { name: "makerAmount", type: "uint256" },
        { name: "takerAmount", type: "uint256" },
        { name: "side", type: "uint8" },
        { name: "expiration", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "feeRateBps", type: "uint256" },
        { name: "signatureType", type: "uint8" }
      ]
    };

    // Convertir les valeurs pour la signature
    const value = {
      salt: order.salt,
      maker: order.maker,
      signer: order.signer,
      taker: order.taker,
      tokenId: order.tokenId,
      makerAmount: order.makerAmount,
      takerAmount: order.takerAmount,
      side: order.side === "BUY" ? 0 : 1,
      expiration: order.expiration,
      nonce: order.nonce,
      feeRateBps: order.feeRateBps,
      signatureType: order.signatureType
    };

    try {
      const signature = await this.wallet.signTypedData(domain, types, value);
      return signature;
    } catch (error) {
      log.error({ error }, "❌ Failed to sign order");
      throw error;
    }
  }

  // Méthode pour annuler des ordres
  async cancelOrders(orderIds: string[]): Promise<any> {
    try {
      const response = await this.client.delete('/orders', {
        data: { orderIds }
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
  async getOrders(): Promise<any> {
    try {
      const response = await this.client.get('/orders?status=OPEN');
      return response.data;
    } catch (error: any) {
      log.error({ 
        error: error.response?.data || error.message 
      }, "❌ Failed to get orders");
      throw error;
    }
  }

  // Méthode pour récupérer les balances (endpoint correct)
  async getBalances(): Promise<any> {
    try {
      const response = await this.client.get('/balance');
      return response.data;
    } catch (error: any) {
      log.error({ 
        error: error.response?.data || error.message 
      }, "❌ Failed to get balances");
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

  // Méthode pour obtenir l'adresse maker (EOA pour l'auth, proxy pour les fonds si spécifié)
  getMakerAddress(): string {
    return this.funderAddress || this.address;
  }
}
