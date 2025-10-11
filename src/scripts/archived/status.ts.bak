// src/scripts/status.ts - Script de monitoring avancé du market maker
import "dotenv/config";
import pino from "pino";
import { CustomClobClient } from "../clients/customClob";
import { InventoryManager } from "../inventory";
import { 
  POLY_PROXY_ADDRESS, 
  RPC_URL, 
  MAX_INVENTORY_YES, 
  MAX_INVENTORY_NO,
  USDC_ADDRESS,
  EXCHANGE_ADDRESS 
} from "../config";
import { JsonRpcProvider } from "ethers";
import { readErc20BalanceAllowance } from "../risk/solvency";
import { OrderCloser } from "../closeOrders";

const log = pino({ name: "status" });

interface MarketStatus {
  marketSlug: string;
  yesTokenId: string;
  noTokenId: string;
  yesInventory: number;
  noInventory: number;
  yesOpenOrders: number;
  noOpenOrders: number;
  yesOrders: any[];
  noOrders: any[];
  yesValue: number;
  noValue: number;
}

async function getMarketStatus(): Promise<MarketStatus[]> {
  const provider = new JsonRpcProvider(RPC_URL);
  const clob = new CustomClobClient(
    process.env.PRIVATE_KEY!,
    process.env.CLOB_API_KEY!,
    process.env.CLOB_API_SECRET!,
    process.env.CLOB_PASSPHRASE!,
    undefined,
    POLY_PROXY_ADDRESS
  );

  const inventory = new InventoryManager(provider, Math.max(MAX_INVENTORY_YES, MAX_INVENTORY_NO));
  const orderCloser = new OrderCloser(clob, inventory, provider);

  try {
    // Récupérer tous les ordres ouverts
    const openOrders = await clob.getOrders({ status: 'OPEN' });
    
    // Grouper les ordres par tokenId
    const ordersByToken = new Map<string, any[]>();
    for (const order of openOrders) {
      const tokenId = order.asset_id;
      if (!ordersByToken.has(tokenId)) {
        ordersByToken.set(tokenId, []);
      }
      ordersByToken.get(tokenId)!.push(order);
    }

    // Récupérer les marchés actifs (hardcodé pour l'instant)
    const markets = [
      {
        slug: "will-donald-trump-win-nobel-peace-prize-in-2025-635",
        yesTokenId: "110231926589098351804293174455681788984678095258631881563984268486591441074567",
        noTokenId: "7997695352317515524525062962990406756331391485123047293096327700752767906309"
      },
      {
        slug: "will-bitcoin-reach-140000-by-december-31-2025-258-893",
        yesTokenId: "31708710617182893420436057149289712855851004287900968100076957544813460654120",
        noTokenId: "58574611769837238797096904875365149395720078009414222609912865927309388209943"
      }
    ];

    const marketStatuses: MarketStatus[] = [];

    for (const market of markets) {
      const yesInventory = inventory.getInventory(market.yesTokenId);
      const noInventory = inventory.getInventory(market.noTokenId);
      const yesOrders = ordersByToken.get(market.yesTokenId) || [];
      const noOrders = ordersByToken.get(market.noTokenId) || [];

      // Estimer la valeur (simplifié - utiliser prix moyens)
      const yesValue = yesInventory * 0.5; // Prix moyen estimé
      const noValue = noInventory * 0.5; // Prix moyen estimé

      marketStatuses.push({
        marketSlug: market.slug,
        yesTokenId: market.yesTokenId.substring(0, 20) + '...',
        noTokenId: market.noTokenId.substring(0, 20) + '...',
        yesInventory,
        noInventory,
        yesOpenOrders: yesOrders.length,
        noOpenOrders: noOrders.length,
        yesOrders,
        noOrders,
        yesValue,
        noValue
      });
    }

    return marketStatuses;
  } catch (error) {
    log.error({ error }, "❌ Error getting market status");
    return [];
  }
}

async function getAllowanceStatus() {
  const provider = new JsonRpcProvider(RPC_URL);
  
  try {
    const { balance: usdcBalanceBigInt, allowance: usdcAllowanceBigInt } = await readErc20BalanceAllowance(
      USDC_ADDRESS,
      POLY_PROXY_ADDRESS,
      EXCHANGE_ADDRESS,
      provider
    );

    const usdcBalance = Number(usdcBalanceBigInt) / 1e6;
    const usdcAllowance = Number(usdcAllowanceBigInt) / 1e6;

    return {
      usdcBalance,
      usdcAllowance,
      hasAllowance: usdcAllowance > 0
    };
  } catch (error) {
    log.error({ error }, "❌ Error getting allowance status");
    return {
      usdcBalance: 0,
      usdcAllowance: 0,
      hasAllowance: false
    };
  }
}

async function displayStatus() {
  log.info("🔍 Récupération du statut du market maker...");

  const [marketStatuses, allowanceStatus] = await Promise.all([
    getMarketStatus(),
    getAllowanceStatus()
  ]);

  console.log("\n" + "=".repeat(80));
  console.log("📊 STATUT DU MARKET MAKER DYNAMIQUE");
  console.log("=".repeat(80));

  // Statut des allowances
  console.log("\n💰 ALLOWANCES ET BALANCES:");
  console.log(`   Solde USDC: ${allowanceStatus.usdcBalance.toFixed(2)} USDC`);
  console.log(`   Allowance USDC: ${allowanceStatus.usdcAllowance.toFixed(2)} USDC`);
  console.log(`   Allowance active: ${allowanceStatus.hasAllowance ? "✅" : "❌"}`);

  // Statut par marché
  console.log("\n📈 MARCHÉS ACTIFS:");
  for (const status of marketStatuses) {
    console.log(`\n   🏛️  ${status.marketSlug}:`);
    console.log(`      YES Token: ${status.yesTokenId}`);
    console.log(`        📦 Inventaire: ${status.yesInventory.toFixed(2)} shares`);
    console.log(`        📝 Ordres ouverts: ${status.yesOpenOrders}`);
    console.log(`        💰 Valeur estimée: ${status.yesValue.toFixed(2)} USDC`);
    
    console.log(`      NO Token: ${status.noTokenId}`);
    console.log(`        📦 Inventaire: ${status.noInventory.toFixed(2)} shares`);
    console.log(`        📝 Ordres ouverts: ${status.noOpenOrders}`);
    console.log(`        💰 Valeur estimée: ${status.noValue.toFixed(2)} USDC`);

    // Détails des ordres
    if (status.yesOrders.length > 0) {
      console.log(`      📋 Ordres YES:`);
      for (const order of status.yesOrders) {
        const side = order.is_buy ? "BUY" : "SELL";
        const price = order.price?.toFixed(4) || "N/A";
        const size = order.size?.toFixed(2) || "N/A";
        console.log(`        ${side} ${size} @ ${price}`);
      }
    }

    if (status.noOrders.length > 0) {
      console.log(`      📋 Ordres NO:`);
      for (const order of status.noOrders) {
        const side = order.is_buy ? "BUY" : "SELL";
        const price = order.price?.toFixed(4) || "N/A";
        const size = order.size?.toFixed(2) || "N/A";
        console.log(`        ${side} ${size} @ ${price}`);
      }
    }
  }

  // Résumé total
  const totalInventory = marketStatuses.reduce((sum, s) => sum + s.yesInventory + s.noInventory, 0);
  const totalValue = marketStatuses.reduce((sum, s) => sum + s.yesValue + s.noValue, 0);
  const totalOpenOrders = marketStatuses.reduce((sum, s) => sum + s.yesOpenOrders + s.noOpenOrders, 0);

  console.log("\n📊 RÉSUMÉ GLOBAL:");
  console.log(`   📦 Inventaire total: ${totalInventory.toFixed(2)} shares`);
  console.log(`   💰 Valeur totale estimée: ${totalValue.toFixed(2)} USDC`);
  console.log(`   📝 Ordres ouverts totaux: ${totalOpenOrders}`);

  // Recommandations
  console.log("\n💡 RECOMMANDATIONS:");
  if (!allowanceStatus.hasAllowance) {
    console.log("   ⚠️  Mettre à jour l'allowance USDC");
  }
  if (totalInventory === 0) {
    console.log("   📈 Aucun inventaire - le bot peut commencer à acheter");
  }
  if (totalOpenOrders === 0) {
    console.log("   📝 Aucun ordre ouvert - vérifier la configuration");
  }
  if (allowanceStatus.usdcBalance < 10) {
    console.log("   💰 Solde USDC faible - considérer un dépôt");
  }

  console.log("\n" + "=".repeat(80));
}

// Exécution du script
if (require.main === module) {
  displayStatus().catch(error => {
    log.error({ error }, "❌ Erreur dans le script de statut");
    process.exit(1);
  });
}

export { displayStatus, getMarketStatus, getAllowanceStatus };
