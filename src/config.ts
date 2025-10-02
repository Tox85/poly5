import * as dotenv from "dotenv";
import { Wallet } from "ethers";

// Charger les variables d'environnement
dotenv.config();

// Endpoints de l'API Polymarket
export const CLOB_API_URL = process.env.CLOB_API_URL || "https://clob.polymarket.com"; 
export const WS_MARKET_URL = process.env.WS_URL || "wss://ws-subscriptions-clob.polymarket.com/ws/market";

// Identifiants d'authentification (depuis .env)
export const PRIVATE_KEY = process.env.PRIVATE_KEY as string;
export const API_KEY = process.env.CLOB_API_KEY as string;
export const API_SECRET = process.env.CLOB_API_SECRET as string;
export const API_PASSPHRASE = process.env.CLOB_PASSPHRASE as string;
export const PROXY_ADDRESS = process.env.POLY_PROXY_ADDRESS as string;  // Adresse du wallet proxy Polymarket

// Paramètres du bot (avec valeurs par défaut si non fournies)
export const MAX_MARKETS = Number(process.env.MAX_MARKETS || 2);
export const QUOTE_USDC_PER_SIDE = Number(process.env.QUOTE_USDC_PER_SIDE || 2);
export const TARGET_SPREAD = Number(process.env.TARGET_SPREAD || 0.005); // Réduit à 0.5 centime
export const MIN_24H_VOLUME = Number(process.env.MIN_24H_VOLUME || 50); // Réduit à 50 USDC

// Paramètres Market Making
export const TARGET_SPREAD_CENTS = Number(process.env.TARGET_SPREAD_CENTS || 2);
export const TICK_IMPROVEMENT = Number(process.env.TICK_IMPROVEMENT || 1);
export const NOTIONAL_PER_ORDER_USDC = Number(process.env.NOTIONAL_PER_ORDER_USDC || 2);
export const BUDGET_GLOBAL_USDC = Number(process.env.BUDGET_GLOBAL_USDC || 50000);
export const BUDGET_PER_MARKET_USDC = Number(process.env.BUDGET_PER_MARKET_USDC || 2000);
export const MAX_ACTIVE_ORDERS = Number(process.env.MAX_ACTIVE_ORDERS || 8);
export const REPLACE_COOLDOWN_MS = Number(process.env.REPLACE_COOLDOWN_MS || 1200);
export const DRY_RUN = process.env.DRY_RUN === 'true';

// Validation de base
if (!PRIVATE_KEY || !API_KEY || !API_SECRET || !API_PASSPHRASE) {
  throw new Error("❌ Identifiants API ou clé privée manquants dans .env. Veuillez configurer votre fichier .env.");
}

// Exporter un signataire pour la signature L1 (chaîne Polygon id 137 pour le mainnet)
export const signerWallet = new Wallet(PRIVATE_KEY);
export const POLYGON_CHAIN_ID = 137;
