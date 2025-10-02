// src/clients/gamma.ts
import axios from "axios";
import pino from "pino";

const log = pino({ name: "gamma" });
const BASE = process.env.GAMMA_API_URL || "https://gamma-api.polymarket.com";

export type GammaMarket = {
  id: string;
  slug: string | null;
  question: string | null;
  conditionId: string;
  enableOrderBook?: boolean | null;
  acceptingOrders?: boolean | null;
  closed?: boolean | null;
  active?: boolean | null;
  archived?: boolean | null;
  endDate?: string | null;
  bestBid?: number | null;
  bestAsk?: number | null;
  volume24hrClob?: number | null;
  clobTokenIds?: string[] | string | null; // Array of token IDs ["yesId", "noId"] or JSON string
  outcomes?: string[] | null; // ["Yes", "No"]
  markets?: GammaMarket[]; // For events with nested markets
};

export async function fetchOpenTradableMarkets(limit=200, offset=0): Promise<GammaMarket[]> {
  // Essayer plusieurs endpoints pour maximiser les chances
  const endpoints = [
    `${BASE}/events?closed=false&limit=${limit}&offset=${offset}`, // Meilleur résultat
    `${BASE}/markets?order=updatedAt&ascending=false&limit=${limit}&offset=${offset}`, // Deuxième meilleur
    `${BASE}/markets?closed=false&limit=${limit}&offset=${offset}` // Fallback
  ];
  
  for (const url of endpoints) {
    log.info({ url }, "Fetching Gamma markets");
    
    try {
      const { data } = await axios.get<GammaMarket[]>(url, { timeout: 15000 });
      const rows = Array.isArray(data) ? data : [];
      
      // Extraire les marchés des événements et filtrer
      const allMarkets: GammaMarket[] = [];
      
      for (const item of rows) {
        if (item.markets && Array.isArray(item.markets)) {
          // C'est un événement avec des marchés imbriqués
          for (const market of item.markets) {
            allMarkets.push(market);
          }
        } else {
          // C'est un marché direct
          allMarkets.push(item);
        }
      }
      
      // Filtrer pour les marchés vraiment actifs
      const filtered = allMarkets.filter(m => {
        // Vérifier que c'est un marché actif et non archivé
        if (m.active !== true || m.closed === true || m.archived === true) return false;
        
        // Vérifier que la date de fin est dans le futur
        if (m.endDate && new Date(m.endDate) <= new Date()) return false;
        
        // Vérifier que l'orderbook est activé
        if (m.enableOrderBook !== true) return false;
        
        // Vérifier qu'on a les token IDs
        if (!m.clobTokenIds) return false;
        
        let tokenIds: string[] = [];
        if (Array.isArray(m.clobTokenIds)) {
          tokenIds = m.clobTokenIds;
        } else if (typeof m.clobTokenIds === 'string') {
          try {
            tokenIds = JSON.parse(m.clobTokenIds);
          } catch (e) {
            return false;
          }
        }
        
        if (tokenIds.length < 2) return false;
        
        return true;
      });
      
      log.info({ url, total: rows.length, tradable: filtered.length }, "gamma markets page");
      
      // Si on trouve des marchés actifs, on les retourne
      if (filtered.length > 0) {
        return filtered;
      }
    } catch (error) {
      log.error({ url, error }, "Failed to fetch Gamma markets");
    }
  }
  
  log.warn("Aucun marché actif trouvé sur tous les endpoints");
  return [];
}

// pagination helper
export async function fetchAllOpenTradableMarkets(maxPages=10): Promise<GammaMarket[]> {
  const acc: GammaMarket[] = [];
  for (let i=0;i<maxPages;i++){
    const page = await fetchOpenTradableMarkets(200, i*200);
    acc.push(...page);
    if (page.length < 200) break;
  }
  return acc;
}
