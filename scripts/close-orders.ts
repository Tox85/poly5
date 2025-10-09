// scripts/close-orders.ts - Script CLI pour fermer les ordres
import "dotenv/config";
import pino from "pino";
import { CustomClobClient } from "../src/clients/customClob";
import { OrderCloser } from "../src/closeOrders";
import { POLY_PROXY_ADDRESS } from "../src/config";
import { JsonRpcProvider } from "ethers";
import { RPC_URL } from "../src/config";

const log = pino({ name: "close-orders" });

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const tokenIdIndex = args.indexOf("--token-id");
  const tokenId = tokenIdIndex > -1 ? args[tokenIdIndex + 1] : undefined;

  log.info({ dryRun, tokenId: tokenId ? tokenId.substring(0, 20) + '...' : 'undefined...' }, "🗑️ Starting order closure script");

  const provider = new JsonRpcProvider(RPC_URL);

  const clob = new CustomClobClient(
    process.env.PRIVATE_KEY!,
    process.env.CLOB_API_KEY!,
    process.env.CLOB_API_SECRET!,
    process.env.CLOB_PASSPHRASE!,
    undefined,
    POLY_PROXY_ADDRESS
  );

  const orderCloser = new OrderCloser(clob, null, provider); // InventoryManager n'est pas nécessaire ici

  if (tokenId) {
    await orderCloser.closeOrdersForToken(tokenId, dryRun);
  } else {
    await orderCloser.closeAllOrders(dryRun);
  }

  log.info({ dryRun, tokenId: tokenId ? tokenId.substring(0, 20) + '...' : 'undefined...' }, "✅ Order closure completed successfully");
}

main().catch(e => {
  log.error({ error: e.message, stack: e.stack }, "❌ Error in close-orders script");
  process.exit(1);
});