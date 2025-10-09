// scripts/healthcheck.ts - Vérification complète de la configuration Polymarket
import 'dotenv/config';
import crypto from 'crypto';
import axios from 'axios';
import { Wallet, JsonRpcProvider, Contract } from 'ethers';
import { buildAmounts } from '../src/lib/amounts';

const {
  CLOB_API_URL, CLOB_API_KEY, CLOB_API_SECRET, CLOB_PASSPHRASE,
  PRIVATE_KEY, POLY_PROXY_ADDRESS,
  EXCHANGE_ADDRESS, USDC_ADDRESS, RPC_URL
} = process.env as Record<string,string>;

function assertEnv(name: string, cond: boolean) {
  if (!cond) throw new Error(`ENV ${name} manquante/invalide`);
}

async function main() {
  try {
    console.log('🔍 Healthcheck Polymarket Bot...\n');

    // 1) ENV validation
    assertEnv("CLOB_API_URL", !!CLOB_API_URL);
    assertEnv("CLOB_API_KEY", !!CLOB_API_KEY);
    assertEnv("CLOB_API_SECRET", !!CLOB_API_SECRET);
    assertEnv("POLY_PROXY_ADDRESS", /^0x[a-fA-F0-9]{40}$/.test(POLY_PROXY_ADDRESS || ""));
    
    // Utiliser des valeurs par défaut pour les contrats
    const rpcUrl = RPC_URL || "https://polygon-rpc.com";
    const exchangeAddress = EXCHANGE_ADDRESS || "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e";
    const usdcAddress = USDC_ADDRESS || "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
    
    console.log('✅ ENV validation OK');

    // 2) Wallet EOA
    const wallet = new Wallet(PRIVATE_KEY!);
    const eoaAddress = await wallet.getAddress();
    console.log('✅ Wallet EOA:', eoaAddress);

    // 3) Auth L2 (HMAC) : GET /data/orders?limit=1
    const now = Date.now().toString();
    const path = "/data/orders?limit=1";
    const prehash = now + "GET" + path;
    const sig = crypto.createHmac("sha256", CLOB_API_SECRET!).update(prehash).digest("hex");

    try {
      const res = await axios.get(CLOB_API_URL + path, {
        headers: {
          "POLY-APIKEY": CLOB_API_KEY,
          "POLY-TIMESTAMP": now,
          "POLY-SIGNATURE": sig,
        },
        timeout: 10_000,
      });
      console.log('✅ Auth L2 OK:', res.status);
    } catch (e: any) {
      console.error('❌ Auth L2 KO:', e.response?.status, e.response?.data || e.message);
      process.exit(1);
    }

    // 4) Montants de test (quantisation 2dp/5dp)
    const testAmounts = buildAmounts('BUY', 0.043, 23.26);
    console.log('✅ Montants test:', {
      price: 0.043,
      size: 23.26,
      notional5: testAmounts.notional5,
      makerAmount: testAmounts.makerAmount.toString(),
      takerAmount: testAmounts.takerAmount.toString()
    });

    // 5) Soldes / allowances on-chain (proxy → exchange)
    const provider = new JsonRpcProvider(rpcUrl);
    const erc20Abi = [
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address,address) view returns (uint256)"
    ];

    const usdc = new Contract(usdcAddress, erc20Abi, provider);
    const [bal, alw] = await Promise.all([
      usdc.balanceOf(POLY_PROXY_ADDRESS),
      usdc.allowance(POLY_PROXY_ADDRESS, exchangeAddress),
    ]);

    const requiredForBuy = testAmounts.makerAmount;
    console.log('USDC Balance/Allowance:', {
      balance: bal.toString(),
      allowance: alw.toString(),
      requiredForBuy: requiredForBuy.toString()
    });

    if (bal >= requiredForBuy) {
      console.log('✅ Solde USDC suffisant pour BUY test');
    } else {
      console.log('❌ Solde USDC insuffisant pour BUY test');
    }

    if (alw >= requiredForBuy) {
      console.log('✅ Allowance USDC suffisante (proxy→exchange)');
    } else {
      console.log('❌ Allowance USDC insuffisante (proxy→exchange)');
    }

    console.log('\n🎯 Healthcheck terminé.');
    
  } catch (e: any) {
    console.error('❌ Erreur healthcheck:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
