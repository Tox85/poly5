// src/lib/amounts.ts - Quantisation des montants pour Polymarket

export type Side = 'BUY' | 'SELL';

/**
 * Convertit un décimal (ex 1.00018) en micro-unités (int, 6 décimales)
 */
export function toMicro(x: number): bigint {
  return BigInt(Math.round(x * 1e6));
}

/**
 * Arrondit à n décimales
 */
export function roundTo(x: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(x * f) / f;
}

/**
 * Quantisation contrôlée par le tick actuel
 */
export function quantize(price: number, size: number, tick: number, minSize: number) {
  const dec = (x: number) => Math.max(0, (tick.toString().split('.')[1] || '').length);
  const priceDecimals = dec(tick);
  const qPrice = Math.round(price / tick) * tick;
  const qPriceFixed = +qPrice.toFixed(priceDecimals);
  const qSize = Math.max(size, minSize);
  // taille arrondie à 2 décimales par défaut (cf. clients officiels) :
  const qSizeFixed = +qSize.toFixed(2);
  return { price: qPriceFixed, size: qSizeFixed };
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
