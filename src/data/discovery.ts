// src/data/discovery.ts
import pino from "pino";
import { fetchAllOpenTradableMarkets } from "../clients/gamma";
// GammaMarket type - UNUSED (removed, type inferred)
// Plus besoin de CustomClobClient - on utilise uniquement l'API Gamma

const log = pino({ name: "discovery" });

type Picked = {
  conditionId: string;
  slug: string;
  yesTokenId: string;
  noTokenId: string;
  bestBidYes?: number|null;
  bestAskYes?: number|null;
  bestBidNo?: number|null;
  bestAskNo?: number|null;
  volume24hrClob?: number|null;
  endDate?: string | null;
  hoursToClose?: number | null;
};

export async function discoverLiveClobMarkets(max=50, minVol=0): Promise<Picked[]> {
  // NOUVELLE APPROCHE: Utiliser uniquement Gamma puisque CLOB ne donne pas de résultats
  const gamma = await fetchAllOpenTradableMarkets();
  
  log.info({ gamma: gamma.length }, "Marchés Gamma trouvés");
  
  const out: Picked[] = [];
  
  for (const gm of gamma) {
    // Filtrer par volume minimum
    if ((gm.volume24hrClob ?? 0) < minVol) continue;
    
    // Utiliser les vrais token IDs de l'API Gamma
    let tokenIds: string[] = [];
    
    if (gm.clobTokenIds && Array.isArray(gm.clobTokenIds)) {
      tokenIds = gm.clobTokenIds;
    } else if (typeof gm.clobTokenIds === 'string') {
      try {
        tokenIds = JSON.parse(gm.clobTokenIds);
      } catch (e) {
        log.warn({ marketId: gm.id, clobTokenIds: gm.clobTokenIds }, "Token IDs mal formatés");
        continue;
      }
    }
    
    if (!tokenIds || tokenIds.length < 2) {
      log.warn({ marketId: gm.id, tokenIds }, "Marché sans token IDs valides");
      continue;
    }
    
    const yesTokenId = tokenIds[0]; // Premier token = Yes
    const noTokenId = tokenIds[1];  // Deuxième token = No
    
    // Calculer les heures avant fermeture
    const end = gm.endDate ? new Date(gm.endDate) : null;
    const hoursToClose = end ? Math.max(0, (end.getTime() - Date.now()) / 3_600_000) : null;
    
    out.push({
      conditionId: gm.conditionId || gm.id,
      slug: gm.slug || gm.id,
      yesTokenId: yesTokenId,
      noTokenId: noTokenId,
      bestBidYes: gm.bestBid ?? null,
      bestAskYes: gm.bestAsk ?? null,
      volume24hrClob: gm.volume24hrClob ?? null,
      endDate: gm.endDate ?? null,
      hoursToClose: hoursToClose
    });
    
    log.info({ 
      marketId: gm.id, 
      slug: gm.slug,
      volume: gm.volume24hrClob,
      bestBid: gm.bestBid,
      bestAsk: gm.bestAsk,
      hoursToClose: hoursToClose?.toFixed(1),
      yesToken: yesTokenId.substring(0, 20) + '...',
      noToken: noTokenId.substring(0, 20) + '...'
    }, "Marché ajouté");
  }
  
  log.info({ gamma: gamma.length, selected: out.length }, "marchés Gamma sélectionnés");
  return out.slice(0, max);
}
