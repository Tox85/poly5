// src/lib/quote-guard.ts
/**
 * Quote Guards - Protection et amélioration des prix pour le market making
 * 
 * POURQUOI: Sur Polymarket, il n'y a pas de "post-only" natif. Si on place un ordre
 * qui "cross the book" (BUY >= bestAsk ou SELL <= bestBid), il sera exécuté immédiatement
 * comme un market order, potentiellement à un prix défavorable.
 * 
 * Cette fonction émule un "post-only" côté client :
 * 1. Empêche les ordres marketables (clamp)
 * 2. Améliore le prix pour avoir la priorité dans la file (tick improvement)
 * 3. Valide les distances du mid-price
 */

export type Side = "BUY" | "SELL";

export interface QuoteGuardOptions {
  /** Amélioration en nombre de ticks (1 tick = 0.001 sur Polymarket) */
  tickImprovement: number;
  /** Distance maximale du mid-price acceptée (en prix, ex: 0.05 = 5¢) */
  maxDistanceFromMid: number;
  /** Activer la protection post-only (recommandé) */
  enablePostOnly: boolean;
}

export interface QuoteGuardResult {
  /** Prix final après garde-fous */
  finalPrice: number;
  /** Le prix cross-t-il le livre (serait marketable) */
  wouldCross: boolean;
  /** Amélioration appliquée en ticks */
  improvementTicks: number;
  /** Distance du mid-price */
  distanceFromMid: number;
  /** Prix a été clampé pour éviter de devenir marketable */
  wasClamped: boolean;
}

/**
 * Assure qu'un ordre sera "post-only" (non marketable) et améliore le prix pour la priorité de file
 * 
 * @param side - "BUY" ou "SELL"
 * @param bestBid - Meilleur prix BID actuel du marché
 * @param bestAsk - Meilleur prix ASK actuel du marché
 * @param tickSize - Taille d'un tick (généralement 0.001 sur Polymarket)
 * @param desiredPrice - Prix souhaité par la stratégie
 * @param options - Options de configuration
 * @returns Prix sécurisé et informations de diagnostic
 */
export function ensurePostOnly(
  side: Side,
  bestBid: number,
  bestAsk: number,
  tickSize: number,
  desiredPrice: number,
  options: QuoteGuardOptions
): QuoteGuardResult {
  const midPrice = (bestBid + bestAsk) / 2;
  let finalPrice = desiredPrice;
  let wasClamped = false;
  let wouldCross = false;

  // Calculer l'amélioration en prix (ticks * tickSize)
  const improvementPrice = options.tickImprovement * tickSize;

  if (options.enablePostOnly) {
    if (side === "BUY") {
      // BUY: Ne jamais dépasser (bestAsk - 1 tick) pour rester post-only
      // Ensuite, améliorer le bestBid de tickImprovement pour avoir la priorité
      const maxBuyPrice = bestAsk - tickSize; // Limite supérieure (post-only)
      const improvedBuyPrice = bestBid + improvementPrice; // Amélioration du best bid

      // Détecter si le prix désiré croiserait le livre
      if (desiredPrice >= bestAsk) {
        wouldCross = true;
        wasClamped = true;
      }

      // Appliquer le clamp : min(désiré, maxBuyPrice) puis max(résultat, improvedBuyPrice)
      finalPrice = Math.min(desiredPrice, maxBuyPrice);
      finalPrice = Math.max(finalPrice, improvedBuyPrice);

      // S'assurer qu'on ne dépasse pas la limite post-only après amélioration
      if (finalPrice >= bestAsk) {
        finalPrice = bestAsk - tickSize;
        wasClamped = true;
      }
    } else {
      // SELL: Ne jamais descendre sous (bestBid + 1 tick) pour rester post-only
      // Ensuite, améliorer le bestAsk de tickImprovement pour avoir la priorité
      const minSellPrice = bestBid + tickSize; // Limite inférieure (post-only)
      const improvedSellPrice = bestAsk - improvementPrice; // Amélioration du best ask

      // Détecter si le prix désiré croiserait le livre
      if (desiredPrice <= bestBid) {
        wouldCross = true;
        wasClamped = true;
      }

      // Appliquer le clamp : max(désiré, minSellPrice) puis min(résultat, improvedSellPrice)
      finalPrice = Math.max(desiredPrice, minSellPrice);
      finalPrice = Math.min(finalPrice, improvedSellPrice);

      // S'assurer qu'on ne descend pas sous la limite post-only après amélioration
      if (finalPrice <= bestBid) {
        finalPrice = bestBid + tickSize;
        wasClamped = true;
      }
    }
  }

  // Arrondir au tick size (important pour Polymarket)
  finalPrice = Math.round(finalPrice / tickSize) * tickSize;

  // Calculer la distance du mid-price
  const distanceFromMid = Math.abs(finalPrice - midPrice);

  // Calculer l'amélioration effective en ticks
  const improvementTicks = side === "BUY" 
    ? Math.round((finalPrice - bestBid) / tickSize)
    : Math.round((bestAsk - finalPrice) / tickSize);

  return {
    finalPrice,
    wouldCross,
    improvementTicks,
    distanceFromMid,
    wasClamped
  };
}

/**
 * Valide que les prix calculés sont cohérents et sûrs
 * 
 * @returns true si les prix sont valides, false sinon
 */
export function validateQuotePrices(
  bidPrice: number,
  askPrice: number,
  bestBid: number,
  bestAsk: number,
  midPrice: number,
  maxDistanceFromMid: number
): { valid: boolean; reason?: string } {
  // Vérifier que bid < ask
  if (bidPrice >= askPrice) {
    return { valid: false, reason: "Bid >= Ask (invalid spread)" };
  }

  // Vérifier que nos prix ne crossent pas le livre
  if (bidPrice >= bestAsk) {
    return { valid: false, reason: "Bid would cross the book (>= bestAsk)" };
  }

  if (askPrice <= bestBid) {
    return { valid: false, reason: "Ask would cross the book (<= bestBid)" };
  }

  // Vérifier la distance du mid-price
  if (Math.abs(bidPrice - midPrice) > maxDistanceFromMid) {
    return { valid: false, reason: `Bid too far from mid (${Math.abs(bidPrice - midPrice).toFixed(4)} > ${maxDistanceFromMid})` };
  }

  if (Math.abs(askPrice - midPrice) > maxDistanceFromMid) {
    return { valid: false, reason: `Ask too far from mid (${Math.abs(askPrice - midPrice).toFixed(4)} > ${maxDistanceFromMid})` };
  }

  // Vérifier que les prix sont dans les limites [0, 1]
  if (bidPrice <= 0 || bidPrice >= 1) {
    return { valid: false, reason: "Bid price out of bounds [0, 1]" };
  }

  if (askPrice <= 0 || askPrice >= 1) {
    return { valid: false, reason: "Ask price out of bounds [0, 1]" };
  }

  return { valid: true };
}

/**
 * Vérifie la parité YES + NO ≈ 1.0
 * Sur Polymarket, P(YES) + P(NO) devrait toujours être proche de 1.0
 * Si ce n'est pas le cas, il y a probablement une inversion de tokens ou un bug
 */
export function checkParity(
  midYes: number,
  midNo: number,
  parityTolerance: number = 0.06
): { valid: boolean; parity: number; deviation: number; warning?: string } {
  const parity = midYes + midNo;
  const deviation = Math.abs(parity - 1.0);
  
  if (deviation > parityTolerance) {
    return {
      valid: false,
      parity,
      deviation,
      warning: `Parity violation: YES + NO = ${parity.toFixed(4)} (deviation: ${deviation.toFixed(4)} > ${parityTolerance})`
    };
  }

  return { valid: true, parity, deviation };
}

