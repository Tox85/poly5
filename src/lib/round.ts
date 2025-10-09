// src/lib/round.ts - Helpers uniformes pour arrondis

/**
 * Arrondit un prix à 3 décimales (0.001)
 */
export function roundPrice(price: number): number {
  return Math.round(price * 1000) / 1000;
}

/**
 * Arrondit une taille à 2 décimales
 */
export function roundSize(size: number): number {
  return Math.floor(size * 100) / 100;
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
