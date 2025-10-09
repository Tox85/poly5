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
    const contract = new Contract(CTF_EXCHANGE_ADDRESS, ERC1155_ABI, provider);
    const balance = await contract.balanceOf(ownerAddress, tokenId);
    
    log.debug({
      tokenId: tokenId.substring(0, 20) + '...',
      owner: ownerAddress.substring(0, 10) + '...',
      balance: balance.toString()
    }, "ERC-1155 balance read");
    
    return balance;
  } catch (error) {
    log.error({ error, tokenId: tokenId.substring(0, 20) + '...' }, "Failed to read ERC-1155 balance");
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
    const contract = new Contract(CTF_EXCHANGE_ADDRESS, ERC1155_ABI, provider);
    const isApproved = await contract.isApprovedForAll(ownerAddress, operatorAddress);
    
    log.debug({
      owner: ownerAddress.substring(0, 10) + '...',
      operator: operatorAddress.substring(0, 10) + '...',
      isApproved
    }, "ERC-1155 approval status");
    
    return isApproved;
  } catch (error) {
    log.error({ error }, "Failed to check ERC-1155 approval");
    return false;
  }
}

