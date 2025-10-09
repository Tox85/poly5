// src/risk/sizing.ts - Contrôles de taille pour éviter les erreurs min-size
import pino from "pino";

const log = pino({ name: "sizing" });

export function enforceMinSize(size: number, minSize: number): number | null {
  // tailles en "shares" → 2 décimales max au CLOB côté taker
  const qSize = Math.floor(size * 100) / 100;
  if (qSize < minSize) return null;
  return qSize;
}

/**
 * Calcule une taille sécurisée avec logique ceil-to-min pour garantir le notional minimum
 * @param notionalUsdc - Notional cible en USDC
 * @param price - Prix par share
 * @param minSize - Taille minimum en shares (défaut: 5)
 * @param minNotional - Notional minimum en USDC (défaut: 1.0)
 * @returns Taille quantisée ou null si impossible de respecter les contraintes
 */
export function calculateSafeSize(
  notionalUsdc: number,
  price: number,
  minSize: number = 5,
  minNotional: number = 1.0
): number | null {
  // Vérifier que le notional cible est au moins égal au minimum
  if (notionalUsdc < minNotional) {
    log.debug({ notionalUsdc, minNotional }, "Notional cible trop faible");
    return null;
  }

  // Taille brute calculée
  const rawSize = notionalUsdc / price;

  // Quantiser vers le haut à 2 décimales (ceil) pour garantir notional >= minNotional
  const ceilSize = Math.ceil(rawSize * 100) / 100;

  // Vérifier que la taille finale respecte minSize
  if (ceilSize < minSize) {
    log.debug({ ceilSize, minSize }, "Taille arrondie trop petite");
    return null; // On n'achète pas si on ne peut pas respecter minSize
  }

  // Vérification finale du notional après quantisation
  const finalNotional = +(price * ceilSize).toFixed(5);
  if (finalNotional < minNotional) {
    log.debug({ finalNotional, minNotional }, "Notional final insuffisant");
    return null; // Sécurité supplémentaire
  }

  log.debug({ 
    notionalUsdc, 
    price, 
    rawSize, 
    ceilSize, 
    finalNotional 
  }, "Taille sécurisée calculée");

  return ceilSize;
}

/**
 * Calcule la taille maximale possible pour un notional donné
 * @param maxNotionalUsdc - Notional maximum en USDC
 * @param price - Prix par share
 * @param minSize - Taille minimum en shares
 * @returns Taille maximale sécurisée ou null
 */
export function calculateMaxSafeSize(
  maxNotionalUsdc: number,
  price: number,
  minSize: number = 5
): number | null {
  return calculateSafeSize(maxNotionalUsdc, price, minSize, 1.0);
}

/**
 * Calcule la taille maximale en tenant compte de l'inventaire actuel
 * @param maxNotionalUsdc - Notional maximum en USDC
 * @param price - Prix par share
 * @param currentInventory - Inventaire actuel
 * @param maxInventory - Inventaire maximum autorisé
 * @param minSize - Taille minimum en shares
 * @returns Taille maximale sécurisée ou null
 */
export function calculateMaxSafeSizeWithInventory(
  maxNotionalUsdc: number,
  price: number,
  currentInventory: number,
  maxInventory: number,
  minSize: number = 5
): number | null {
  // Calculer la taille maximale basée sur le notional
  const maxSizeByNotional = calculateMaxSafeSize(maxNotionalUsdc, price, minSize);
  if (!maxSizeByNotional) return null;

  // Calculer la taille maximale basée sur l'inventaire
  const maxSizeByInventory = maxInventory - currentInventory;
  
  // Retourner la plus petite des deux
  const finalSize = Math.min(maxSizeByNotional, maxSizeByInventory);
  
  if (finalSize < minSize) {
    log.debug({ 
      maxSizeByNotional, 
      maxSizeByInventory, 
      currentInventory, 
      maxInventory, 
      minSize 
    }, "Taille limitée par inventaire");
    return null;
  }

  return finalSize;
}

/**
 * Calcule une taille sécurisée pour les ordres SELL avec notional minimum
 * @param notionalUsdc - Notional cible en USDC
 * @param price - Prix par share
 * @param minSize - Taille minimum en shares (défaut: 5)
 * @param minNotional - Notional minimum en USDC (défaut: 1.0)
 * @returns Taille quantisée pour la vente ou null si impossible
 */
export function calculateSellSize(
  notionalUsdc: number,
  price: number,
  minSize: number = 5,
  minNotional: number = 1.0
): number | null {
  // Vérifier le notional minimum
  if (notionalUsdc < minNotional) {
    log.debug({ notionalUsdc, minNotional }, "Notional too low for SELL");
    return null;
  }

  // Calculer la taille brute
  const rawSize = notionalUsdc / price;
  
  // Quantiser vers le HAUT pour garantir notional >= minNotional (comme pour BUY)
  const ceilSize = Math.ceil(rawSize * 100) / 100;
  
  // Vérifier la taille minimum
  if (ceilSize < minSize) {
    log.debug({ 
      rawSize, 
      ceilSize, 
      minSize, 
      price,
      notionalUsdc 
    }, "Size too small for minimum requirements");
    return null;
  }

  // Vérifier le notional final
  const finalNotional = +(price * ceilSize).toFixed(5);
  if (finalNotional < minNotional) {
    log.debug({ 
      price, 
      ceilSize, 
      finalNotional, 
      minNotional 
    }, "Final notional too low");
    return null;
  }

  log.debug({ 
    price, 
    rawSize, 
    ceilSize, 
    finalNotional,
    notionalUsdc 
  }, "Sell size calculated");

  return ceilSize;
}
