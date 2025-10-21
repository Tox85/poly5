// src/lib/erc1155.ts - Gestion des tokens ERC-1155 on-chain
import { Contract, JsonRpcProvider } from "ethers";
import pino from "pino";

const log = pino({ name: "erc1155" });

// ABI minimal pour ERC-1155 (balanceOf et setApprovalForAll)
const ERC1155_ABI = [
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function setApprovalForAll(address operator, bool approved) external",
  "function isApprovedForAll(address account, address operator) view returns (bool)"
];

// Adresse du contrat CTF (Conditional Token Framework) sur Polygon
const CTF_EXCHANGE_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";

// ✅ FIX #5: Cache pour les approbations ERC-1155 (éviter de surcharger le RPC)
const approvalCache = new Map<string, { isApproved: boolean, timestamp: number }>();
const APPROVAL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ✅ FIX #5: Cache pour les balances ERC-1155 (éviter trop d'appels RPC)
const balanceCache = new Map<string, { balance: bigint, timestamp: number }>();
const BALANCE_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Lit le solde d'un token ERC-1155 pour une adresse donnée
 * @param provider Provider Ethereum
 * @param tokenId ID du token ERC-1155
 * @param ownerAddress Adresse du détenteur
 * @returns Solde en micro-unités (6 décimales)
 */
export async function readErc1155Balance(
  provider: JsonRpcProvider,
  tokenId: string,
  ownerAddress: string
): Promise<bigint> {
  try {
    // ✅ FIX #5: Vérifier le cache d'abord
    const cacheKey = `${ownerAddress}-${tokenId}`;
    const cached = balanceCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < BALANCE_CACHE_TTL_MS) {
      log.debug({
        tokenId: tokenId.substring(0, 20) + '...',
        owner: ownerAddress.substring(0, 10) + '...',
        balance: cached.balance.toString(),
        source: "cache"
      }, "ERC-1155 balance (cached)");
      return cached.balance;
    }
    
    const contract = new Contract(CTF_EXCHANGE_ADDRESS, ERC1155_ABI, provider);
    
    // ✅ FIX #5: Ajouter un timeout pour éviter d'attendre indéfiniment
    const timeoutPromise = new Promise<bigint>((_, reject) => {
      setTimeout(() => reject(new Error("RPC timeout (30s)")), 30000);
    });
    
    const balancePromise = contract.balanceOf(ownerAddress, tokenId);
    const balance = await Promise.race([balancePromise, timeoutPromise]) as bigint;
    
    // Mettre en cache
    balanceCache.set(cacheKey, { balance, timestamp: Date.now() });
    
    log.debug({
      tokenId: tokenId.substring(0, 20) + '...',
      owner: ownerAddress.substring(0, 10) + '...',
      balance: balance.toString(),
      source: "blockchain"
    }, "ERC-1155 balance read (fresh)");
    
    return balance;
  } catch (error) {
    log.error({ error, tokenId: tokenId.substring(0, 20) + '...' }, "Failed to read ERC-1155 balance");
    // ✅ FIX #5: En cas d'erreur, retourner le cache s'il existe (optimistic)
    const cacheKey = `${ownerAddress}-${tokenId}`;
    const cached = balanceCache.get(cacheKey);
    if (cached) {
      log.warn({
        tokenId: tokenId.substring(0, 20) + '...',
        balance: cached.balance.toString(),
        reason: "RPC failed, using stale cache"
      }, "Using cached balance despite error");
      return cached.balance;
    }
    return BigInt(0);
  }
}

/**
 * Vérifie si l'Exchange a l'approbation pour gérer les tokens de l'utilisateur
 * @param provider Provider Ethereum
 * @param ownerAddress Adresse du détenteur
 * @param operatorAddress Adresse de l'Exchange
 * @returns true si approuvé
 */
export async function isApprovedForAll(
  provider: JsonRpcProvider,
  ownerAddress: string,
  operatorAddress: string
): Promise<boolean> {
  try {
    // ✅ FIX #5: Vérifier le cache d'abord pour éviter les appels RPC répétés
    const cacheKey = `${ownerAddress}-${operatorAddress}`;
    const cached = approvalCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < APPROVAL_CACHE_TTL_MS) {
      log.debug({
        owner: ownerAddress.substring(0, 10) + '...',
        operator: operatorAddress.substring(0, 10) + '...',
        isApproved: cached.isApproved,
        source: "cache"
      }, "ERC-1155 approval status (cached)");
      return cached.isApproved;
    }
    
    // Si pas de cache ou expiré, interroger la blockchain avec timeout
    const contract = new Contract(CTF_EXCHANGE_ADDRESS, ERC1155_ABI, provider);
    
    // ✅ FIX #5: Ajouter un timeout pour éviter d'attendre indéfiniment
    const timeoutPromise = new Promise<boolean>((_, reject) => {
      setTimeout(() => reject(new Error("RPC timeout (30s)")), 30000);
    });
    
    const checkPromise = contract.isApprovedForAll(ownerAddress, operatorAddress);
    const isApproved = await Promise.race([checkPromise, timeoutPromise]) as boolean;
    
    // Mettre en cache le résultat
    approvalCache.set(cacheKey, { isApproved, timestamp: Date.now() });
    
    log.debug({
      owner: ownerAddress.substring(0, 10) + '...',
      operator: operatorAddress.substring(0, 10) + '...',
      isApproved,
      source: "blockchain"
    }, "ERC-1155 approval status (fresh)");
    
    return isApproved;
  } catch (error) {
    log.error({ error }, "Failed to check ERC-1155 approval");
    // ✅ FIX #5: En cas d'erreur, retourner true par défaut si on a déjà vu une approbation
    const cacheKey = `${ownerAddress}-${operatorAddress}`;
    const cached = approvalCache.get(cacheKey);
    if (cached && cached.isApproved) {
      log.warn({
        owner: ownerAddress.substring(0, 10) + '...',
        reason: "RPC failed, using cached approval (optimistic)"
      }, "Using cached ERC-1155 approval despite error");
      return true;
    }
    return false;
  }
}

