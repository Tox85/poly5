// src/lib/math.ts
// CANON: Fusion de amounts.ts + round.ts + sizing.ts
// Point unique pour tous les utilitaires mathématiques

export type Side = 'BUY' | 'SELL';

// ════════════════════════════════════════════════════════════════
// ARRONDIS GÉNÉRIQUES
// ════════════════════════════════════════════════════════════════

/**
 * Arrondit vers le "plus proche" à n décimales
 */
export function roundTo(x: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(x * f) / f;
}

/**
 * Arrondit un prix à 3 décimales (0.001)
 */
export function roundPrice(price: number): number {
  return Math.round(price * 1000) / 1000;
}

/**
 * Arrondit une taille à 2 décimales (floor pour sécurité)
 */
export function roundSize(size: number): number {
  return Math.floor(size * 100) / 100;
}

// ════════════════════════════════════════════════════════════════
// QUANTISATION POLYMARKET (amounts.ts)
// ════════════════════════════════════════════════════════════════

/**
 * Convertit un décimal (ex 1.00018) en micro-unités (int, 6 décimales)
 */
export function toMicro(x: number): bigint {
  return BigInt(Math.round(x * 1e6));
}

/**
 * Règle Polymarket (implicite dans les erreurs serveur) :
 * - shares -> 2 décimales
 * - notional USDC -> 5 décimales
 * Puis on envoie TOUT en micro-unités (×1e6).
 */
export function buildAmounts(side: Side, price: number, size: number) {
  const size2 = roundTo(size, 2);             // shares quantisées à 2 décimales
  const notional5 = roundTo(price * size2, 5); // USDC notional à 5 décimales

  if (side === 'BUY') {
    return {
      makerAmount: toMicro(notional5), // USDC payé
      takerAmount: toMicro(size2),     // shares reçues
      size2,
      notional5,
    };
  } else {
    return {
      makerAmount: toMicro(size2),     // shares vendues
      takerAmount: toMicro(notional5), // USDC reçu
      size2,
      notional5,
    };
  }
}

// ════════════════════════════════════════════════════════════════
// SIZING (sizing.ts)
// ════════════════════════════════════════════════════════════════

/**
 * Force une taille minimum
 */
export function enforceMinSize(size: number, minSize: number): number | null {
  // tailles en "shares" → 2 décimales max au CLOB côté taker
  const qSize = Math.floor(size * 100) / 100;
  if (qSize < minSize) return null;
  return qSize;
}

/**
 * Calcule une taille sécurisée avec logique ceil-to-min pour garantir le notional minimum
 */
export function calculateSafeSize(
  notionalUsdc: number,
  price: number,
  minSize: number = 5,
  minNotional: number = 1.0
): number | null {
  // Vérifier que le notional cible est au moins égal au minimum
  if (notionalUsdc < minNotional) {
    return null;
  }

  // Taille brute calculée
  const rawSize = notionalUsdc / price;

  // Quantiser vers le haut à 2 décimales (ceil) pour garantir notional >= minNotional
  const ceilSize = Math.ceil(rawSize * 100) / 100;

  // Vérifier que la taille finale respecte minSize
  if (ceilSize < minSize) {
    return null;
  }

  // Vérification finale du notional après quantisation
  const finalNotional = +(price * ceilSize).toFixed(5);
  if (finalNotional < minNotional) {
    return null;
  }

  return ceilSize;
}

/**
 * Calcule la taille maximale possible pour un notional donné
 */
export function calculateMaxSafeSize(
  maxNotionalUsdc: number,
  price: number,
  minSize: number = 5
): number | null {
  return calculateSafeSize(maxNotionalUsdc, price, minSize, 1.0);
}

/**
 * Calcule une taille sécurisée pour les ordres SELL avec notional minimum
 */
export function calculateSellSize(
  notionalUsdc: number,
  price: number,
  minSize: number = 5,
  minNotional: number = 1.0
): number | null {
  // Vérifier le notional minimum
  if (notionalUsdc < minNotional) {
    return null;
  }

  // Calculer la taille brute
  const rawSize = notionalUsdc / price;
  
  // Quantiser vers le HAUT pour garantir notional >= minNotional
  const ceilSize = Math.ceil(rawSize * 100) / 100;
  
  // Vérifier la taille minimum
  if (ceilSize < minSize) {
    return null;
  }

  // Vérifier le notional final
  const finalNotional = +(price * ceilSize).toFixed(5);
  if (finalNotional < minNotional) {
    return null;
  }

  return ceilSize;
}

/**
 * Calcule la taille SELL basée sur l'inventaire disponible (en shares)
 * Garantit un minimum de 5 shares
 */
export function calculateSellSizeShares(
  availableShares: number,
  price: number,
  maxSharesPerOrder: number = 50,
  minShares: number = 5,
  minNotionalSellUsdc: number = 1.0
): number | null {
  // Vérifier qu'on a assez de shares pour vendre
  if (availableShares < minShares) {
    return null;
  }
  
  // Calculer la taille basée sur l'inventaire disponible
  let size = Math.floor(Math.min(availableShares, maxSharesPerOrder) * 100) / 100;
  
  // Vérifier le minimum de shares
  if (size < minShares) {
    return null;
  }
  
  // Vérifier le notional minimum
  const finalNotional = price * size;
  if (finalNotional < minNotionalSellUsdc) {
    size = Math.ceil((minNotionalSellUsdc / price) * 100) / 100;
    if (size > availableShares) {
      return null;
    }
  }
  
  return size;
}

