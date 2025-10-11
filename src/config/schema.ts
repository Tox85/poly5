// src/config/schema.ts
// Validation runtime des variables d'environnement avec Zod

import { z } from 'zod';

// Schéma de validation pour toutes les variables .env requises/optionnelles
export const EnvSchema = z.object({
  // === CREDENTIALS (Required) ===
  PRIVATE_KEY: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/, 'Invalid private key format'),
  
  // === POLYMARKET API (Required pour production) ===
  CLOB_API_KEY: z.string().optional(),
  CLOB_API_SECRET: z.string().optional(),
  CLOB_PASSPHRASE: z.string().optional(),
  
  // === ADDRESSES ===
  POLY_PROXY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid proxy address').optional(),
  
  // === RPC ===
  RPC_URL: z.string().url().optional().default('https://polygon-rpc.com'),
  
  // === MODE ===
  DRY_RUN: z.enum(['true', 'false']).optional().transform(val => val === 'true'),
  
  // === MARKET MAKING CONFIG ===
  TARGET_SPREAD_CENTS: z.coerce.number().min(0.1).max(100).optional(),
  TICK_IMPROVEMENT: z.coerce.number().min(0).max(10).optional(),
  NOTIONAL_PER_ORDER_USDC: z.coerce.number().min(0.1).max(1000).optional(),
  MAX_ACTIVE_ORDERS: z.coerce.number().min(1).max(1000).optional(),
  REPLACE_COOLDOWN_MS: z.coerce.number().min(100).max(30000).optional(),
  
  // === INVENTORY ===
  MAX_INVENTORY: z.coerce.number().min(1).max(10000).optional(),
  MAX_INVENTORY_YES: z.coerce.number().min(1).max(10000).optional(),
  MAX_INVENTORY_NO: z.coerce.number().min(1).max(10000).optional(),
  MIN_INVENTORY_CLEANUP: z.coerce.number().min(0).max(100).optional(),
  
  // === ALLOWANCE ===
  ALLOWANCE_THRESHOLD_USDC: z.coerce.number().min(1).max(100000).optional(),
  ALLOWANCE_CHECK_COOLDOWN_MS: z.coerce.number().min(1000).max(300000).optional(),
  
  // === SPREAD ===
  SPREAD_MULTIPLIER_LOW: z.coerce.number().min(0.1).max(10).optional(),
  SPREAD_MULTIPLIER_HIGH: z.coerce.number().min(0.1).max(10).optional(),
  MIN_SPREAD_CENTS: z.coerce.number().min(0.01).max(50).optional(),
  MAX_SPREAD_CENTS: z.coerce.number().min(0.1).max(100).optional(),
  
  // === PARITY ===
  PARITY_THRESHOLD: z.coerce.number().min(0.001).max(0.1).optional(),
  
  // === SIZING ===
  MIN_SIZE_SHARES: z.coerce.number().min(0.1).max(1000).optional(),
  MIN_NOTIONAL_USDC: z.coerce.number().min(0.1).max(1000).optional(),
  MIN_NOTIONAL_SELL_USDC: z.coerce.number().min(0.1).max(1000).optional(),
  MAX_SELL_PER_ORDER_SHARES: z.coerce.number().min(1).max(10000).optional(),
  
  // === PERSISTENCE ===
  INVENTORY_PERSISTENCE_FILE: z.string().optional(),
  PNL_PERSISTENCE_FILE: z.string().optional(),
  
  // === NOTIONAL ADAPTIVE ===
  AUTO_ADJUST_NOTIONAL: z.enum(['true', 'false']).optional().transform(val => val === 'true'),
  
  // === PRICE ===
  PRICE_CHANGE_THRESHOLD: z.coerce.number().min(0.0001).max(1).optional(),
  MAX_DISTANCE_FROM_MID: z.coerce.number().min(0.001).max(0.5).optional(),
  
  // === MARKETS ===
  MAX_ACTIVE_MARKETS: z.coerce.number().min(1).max(20).optional(),
  MIN_VOLUME_USDC: z.coerce.number().min(100).max(10000000).optional(),
  
  // === RISK ===
  MAX_NOTIONAL_AT_RISK_USDC: z.coerce.number().min(1).max(100000).optional(),
  RECONCILE_INTERVAL_MS: z.coerce.number().min(10000).max(600000).optional(),
  
  // === METRICS ===
  METRICS_LOG_INTERVAL_MS: z.coerce.number().min(5000).max(600000).optional(),
  
  // === WEBSOCKET ===
  WSS_URL: z.string().url().optional(),
  WSS_USER_URL: z.string().url().optional(),
  
  // === SKEW ===
  INVENTORY_SKEW_LAMBDA: z.coerce.number().min(0).max(1).optional(),
  ORDER_TTL_MS: z.coerce.number().min(1000).max(300000).optional(),
  
  // === LOGGING ===
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).optional(),
});

export type ValidatedEnv = z.infer<typeof EnvSchema>;

/**
 * Parse et valide les variables d'environnement
 * Fail-fast si configuration invalide
 */
export function parseEnv(env: NodeJS.ProcessEnv): ValidatedEnv {
  const result = EnvSchema.safeParse(env);
  
  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    console.error(result.error.flatten().fieldErrors);
    console.error('\n📋 Check your .env file against env.example');
    process.exit(1);
  }
  
  console.log('✅ Environment configuration validated');
  return result.data;
}

