// src/utils/approve.ts - Utilitaire d'approbation USDC pour le proxy
import { CustomClobClient } from "../clients/customClob";
import { JsonRpcProvider } from "ethers";
import { USDC_ADDRESS, RPC_URL, POLY_PROXY_ADDRESS, EXCHANGE_ADDRESS } from "../config";
import { readErc20BalanceAllowance } from "../risk/solvency";

// Approuve le spender (Exchange) pour dépenser les USDC du proxy
export async function ensureUsdcAllowance(
  apiKey: string,
  apiSecret: string,
  passphrase: string,
  privateKey: string,
  minAllowanceUSDC: number = 100 // alloue $100 par défaut
) {
  const provider = new JsonRpcProvider(RPC_URL);
  
  const clob = new CustomClobClient(
    privateKey,
    apiKey,
    apiSecret,
    passphrase,
    undefined,
    POLY_PROXY_ADDRESS
  );

  try {
    // Vérifier l'allowance actuelle via notre système
    const balanceAllowance = await readErc20BalanceAllowance(
      USDC_ADDRESS,
      POLY_PROXY_ADDRESS,
      EXCHANGE_ADDRESS,
      provider
    );

    const minMicro = BigInt(Math.round(minAllowanceUSDC * 1e6));
    
    if (balanceAllowance.allowance < minMicro) {
      console.log(`🔐 Approbation USDC nécessaire: ${minAllowanceUSDC} USDC`);
      
      // Mettre à jour l'allowance via le CLOB
      await clob.updateBalanceAllowance({
        asset_type: "COLLATERAL"
      });
      
      console.log(`✅ Approbation USDC accordée: ${minAllowanceUSDC} USDC`);
    } else {
      console.log(`✅ Allowance USDC suffisante: ${Number(balanceAllowance.allowance) / 1e6} USDC`);
    }
  } catch (error) {
    console.error("❌ Erreur lors de la vérification/mise à jour de l'allowance:", error);
    throw error;
  }
}
