// src/data/book.ts
import { CustomClobClient } from "../clients/customClob";

export type Top = { bestBid:number|null; bestAsk:number|null; tickSize:number|null; negRisk:boolean|null };

export async function snapshotTop(tokenId: string): Promise<Top> {
  const clob = new CustomClobClient(
    process.env.PRIVATE_KEY!,
    process.env.CLOB_API_KEY!,
    process.env.CLOB_API_SECRET!,
    process.env.CLOB_PASSPHRASE!,
    undefined, // baseURL par défaut
    process.env.POLY_PROXY_ADDRESS // funderAddress = proxy avec les fonds USDC
  );
  const book = await clob.getOrderBook(tokenId); // REST /book
  
  // Ne pas forcer des valeurs par défaut - utiliser ce que le serveur fournit
  const bestBid = book?.bids?.length ? Number(book.bids[0].price) : null;
  const bestAsk = book?.asks?.length ? Number(book.asks[0].price) : null;
  
  // Respecter le tick_size du serveur, pas de fallback
  const tick = book?.tick_size ? Number(book.tick_size) : null;
  const neg = book?.neg_risk ? Boolean(book.neg_risk) : null;
  
  return { bestBid, bestAsk, tickSize: tick, negRisk: neg };
}
