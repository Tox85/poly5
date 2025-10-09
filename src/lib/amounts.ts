// src/lib/amounts.ts - Quantisation correcte selon les spécifications Polymarket
export type Side = 'BUY' | 'SELL';

// Arrondit vers le "plus proche" à n décimales
function roundTo(x: number, decimals: number) {
  const f = Math.pow(10, decimals);
  return Math.round(x * f) / f;
}

// Convertit un décimal (ex 1.00018) en micro-unités (int, 6 décimales)
export function toMicro(x: number): bigint {
  return BigInt(Math.round(x * 1e6));
}

// Règle Polymarket (implicite dans les erreurs serveur) :
// - shares -> 2 décimales
// - notional USDC -> 5 décimales
// Puis on envoie TOUT en micro-unités (×1e6).
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
