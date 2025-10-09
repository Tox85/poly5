// src/allowanceManager.ts - Gestion automatique des allowances USDC
import pino from "pino";
import { JsonRpcProvider } from "ethers";
import { CustomClobClient } from "./clients/customClob";
import { USDC_ADDRESS, POLY_PROXY_ADDRESS, EXCHANGE_ADDRESS, ALLOWANCE_CHECK_COOLDOWN_MS } from "./config";
import { readErc20BalanceAllowance } from "./risk/solvency";

const log = pino({ name: "allowanceManager" });

export class AllowanceManager {
  private clob: CustomClobClient;
  private provider: JsonRpcProvider;
  private allowanceThresholdUsdc: number;
  private lastAllowanceCheckTime: number = 0;
  private currentUsdcAllowance: bigint = BigInt(0);
  private currentUsdcBalance: bigint = BigInt(0);
  private isUpdating: boolean = false;

  constructor(
    clob: CustomClobClient,
    provider: JsonRpcProvider,
    allowanceThresholdUsdc: number = 100
  ) {
    this.clob = clob;
    this.provider = provider;
    this.allowanceThresholdUsdc = allowanceThresholdUsdc;
    log.info({ allowanceThresholdUsdc }, "💰 AllowanceManager initialized");
  }

  /**
   * Vérifie et assure que l'allowance USDC est suffisante.
   * Si l'allowance est inférieure au seuil, elle est augmentée via l'API CLOB.
   * @returns true si l'allowance est suffisante ou a été mise à jour avec succès, false sinon.
   */
  async ensureUsdcAllowance(): Promise<boolean> {
    try {
      // Éviter les appels simultanés
      if (this.isUpdating) {
        log.debug("Allowance update already in progress, skipping...");
        return true;
      }

      // Lire le solde et l'allowance USDC depuis la blockchain
      const { balance, allowance } = await readErc20BalanceAllowance(
        USDC_ADDRESS,
        POLY_PROXY_ADDRESS,
        EXCHANGE_ADDRESS,
        this.provider
      );

      // Mettre à jour le cache IMMÉDIATEMENT
      this.currentUsdcAllowance = allowance;
      this.currentUsdcBalance = balance;
      
      log.debug({
        balanceUsdc: (Number(balance) / 1e6).toFixed(2),
        allowanceUsdc: (Number(allowance) / 1e6).toFixed(2)
      }, "📊 USDC balance/allowance read from blockchain");

      const minMicro = BigInt(Math.round(this.allowanceThresholdUsdc * 1e6));
      const balanceUsdc = Number(balance) / 1e6;
      const allowanceUsdc = Number(allowance) / 1e6;

      log.debug({
        balanceUsdc: balanceUsdc.toFixed(2),
        allowanceUsdc: allowanceUsdc.toFixed(2),
        threshold: this.allowanceThresholdUsdc
      }, "Checking USDC allowance...");

      if (allowance < minMicro) {
        // Vérifier qu'on a assez de balance pour l'allowance
        if (balance < minMicro) {
          log.error({
            balanceUsdc: balanceUsdc.toFixed(2),
            requiredUsdc: this.allowanceThresholdUsdc
          }, "❌ Insufficient USDC balance for allowance");
          return false;
        }

        this.isUpdating = true;
        log.warn({
          currentAllowance: allowanceUsdc.toFixed(2),
          threshold: this.allowanceThresholdUsdc
        }, "🔐 USDC allowance too low, requesting update via CLOB API...");

        // Utiliser la méthode du CustomClobClient pour mettre à jour l'allowance
        await this.clob.updateBalanceAllowance({
          asset_type: "COLLATERAL"
        });

        log.info({ newAllowance: this.allowanceThresholdUsdc }, "✅ USDC allowance updated successfully via CLOB API.");
        
        // Mettre à jour notre cache local
        this.currentUsdcAllowance = minMicro;
        this.isUpdating = false;
        return true;
      } else {
        log.debug({
          currentAllowance: allowanceUsdc.toFixed(2),
          threshold: this.allowanceThresholdUsdc
        }, "✅ USDC allowance is sufficient.");
        return true;
      }
    } catch (error) {
      this.isUpdating = false;
      log.error({ error }, "❌ Failed to ensure USDC allowance.");
      return false;
    }
  }

  /**
   * Effectue une vérification périodique de l'allowance USDC pour éviter les appels trop fréquents.
   */
  async periodicUsdcCheck(): Promise<void> {
    const now = Date.now();
    if (now - this.lastAllowanceCheckTime > ALLOWANCE_CHECK_COOLDOWN_MS) {
      log.debug("Performing periodic USDC allowance check...");
      await this.ensureUsdcAllowance();
      this.lastAllowanceCheckTime = now;
    }
  }

  /**
   * Force une vérification immédiate de l'allowance USDC.
   */
  async forceUsdcCheck(): Promise<boolean> {
    log.info("Forcing immediate USDC allowance check...");
    this.lastAllowanceCheckTime = 0; // Reset cooldown
    return await this.ensureUsdcAllowance();
  }

  /**
   * Retourne un résumé du statut des allowances.
   */
  getSummary(): any {
    return {
      usdcAllowance: (Number(this.currentUsdcAllowance) / 1e6).toFixed(2),
      usdcBalance: (Number(this.currentUsdcBalance) / 1e6).toFixed(2),
      threshold: this.allowanceThresholdUsdc.toFixed(2),
      lastCheck: this.lastAllowanceCheckTime,
      isUpdating: this.isUpdating,
      allowanceSufficient: this.currentUsdcAllowance >= BigInt(Math.round(this.allowanceThresholdUsdc * 1e6))
    };
  }

  /**
   * Vérifie si l'allowance actuelle est suffisante pour un montant donné.
   * @param requiredUsdc Montant USDC requis
   * @returns true si l'allowance est suffisante
   */
  isAllowanceSufficient(requiredUsdc: number): boolean {
    const requiredMicro = BigInt(Math.round(requiredUsdc * 1e6));
    return this.currentUsdcAllowance >= requiredMicro;
  }

  /**
   * Vérifie si le solde USDC est suffisant pour un montant donné.
   * @param requiredUsdc Montant USDC requis
   * @returns true si le solde est suffisant
   */
  isBalanceSufficient(requiredUsdc: number): boolean {
    const requiredMicro = BigInt(Math.round(requiredUsdc * 1e6));
    return this.currentUsdcBalance >= requiredMicro;
  }

  /**
   * Vérifie et met à jour l'allowance pour les tokens outcome (ERC-1155).
   * Cette méthode utilise l'API CLOB pour lire et mettre à jour l'allowance des tokens conditionnels.
   * @param tokenId L'ID du token ERC-1155
   * @param requiredShares Le nombre de shares requis (optionnel, 0 = mettre à jour pour tout le solde)
   * @returns true si l'allowance est suffisante ou a été mise à jour avec succès
   */
  async ensureOutcomeTokenAllowance(tokenId: string, requiredShares: number = 0): Promise<boolean> {
    try {
      // Demander le statut actuel via le CLOB
      const { balance, allowance } = await this.clob.getBalanceAllowance({
        asset_type: "CONDITIONAL" as any,
        token_id: tokenId,
      });

      const balanceShares = Number(balance) / 1e6;
      const allowanceShares = Number(allowance) / 1e6;

      // Si l'allowance est inférieure au nombre de shares détenues ou au besoin immédiat, augmenter l'allowance
      const threshold = requiredShares > 0 ? requiredShares : balanceShares;
      
      log.debug({
        tokenId: tokenId.substring(0, 20) + '...',
        balanceShares: balanceShares.toFixed(2),
        allowanceShares: allowanceShares.toFixed(2),
        requiredShares,
        threshold
      }, "Checking outcome token allowance...");

      if (allowanceShares < threshold) {
        log.warn({
          tokenId: tokenId.substring(0, 20) + '...',
          currentAllowance: allowanceShares.toFixed(2),
          required: threshold.toFixed(2)
        }, "🔐 Outcome token allowance too low, requesting update via CLOB API...");

        await this.clob.updateBalanceAllowance({
          asset_type: "CONDITIONAL" as any,
          token_id: tokenId,
        });

        log.info({ 
          tokenId: tokenId.substring(0, 20) + '...', 
          newAllowance: balanceShares.toFixed(2) 
        }, "✅ Outcome token allowance updated");
        return true;
      }

      log.debug({
        tokenId: tokenId.substring(0, 20) + '...',
        allowanceShares: allowanceShares.toFixed(2)
      }, "✅ Outcome token allowance is sufficient");
      return true;

    } catch (error) {
      log.error({ error, tokenId: tokenId.substring(0, 20) + '...' }, "❌ Failed to update outcome token allowance");
      return false;
    }
  }

  /**
   * Met à jour le seuil d'allowance.
   * @param newThreshold Nouveau seuil en USDC
   */
  updateThreshold(newThreshold: number): void {
    this.allowanceThresholdUsdc = newThreshold;
    log.info({ newThreshold }, "Allowance threshold updated");
  }
}