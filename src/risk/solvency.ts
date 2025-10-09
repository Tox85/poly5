// src/risk/solvency.ts - Vérifications de balance et allowance
import { Contract, JsonRpcProvider } from 'ethers';

export type BalanceAllowance = {
  balance: bigint;     // en micro (1e6) pour USDC / outcome tokens
  allowance: bigint;   // idem
};

// helper de lecture on-chain
export async function readErc20BalanceAllowance(
  token: string,
  owner: string,      // proxy wallet
  spender: string,    // exchange
  provider: JsonRpcProvider
): Promise<BalanceAllowance> {
  const abi = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)"
  ];
  const c = new Contract(token, abi, provider);
  const [bal, alw] = await Promise.all([
    c.balanceOf(owner),
    c.allowance(owner, spender),
  ]);
  return { balance: BigInt(bal), allowance: BigInt(alw) };
}

export function hasFundsAndAllowance(
  required: bigint,     // en micro (1e6)
  ba: BalanceAllowance
): boolean {
  return ba.balance >= required && ba.allowance >= required;
}

export async function checkBuySolvency(
  requiredUsdcMicro: bigint,
  usdcAddress: string,
  proxyAddress: string,
  exchangeAddress: string,
  provider: JsonRpcProvider
): Promise<boolean> {
  const ba = await readErc20BalanceAllowance(
    usdcAddress, 
    proxyAddress, 
    exchangeAddress, 
    provider
  );
  return hasFundsAndAllowance(requiredUsdcMicro, ba);
}

export async function checkSellSolvency(
  requiredSharesMicro: bigint,
  outcomeTokenAddress: string,
  proxyAddress: string,
  exchangeAddress: string,
  provider: JsonRpcProvider
): Promise<boolean> {
  const ba = await readErc20BalanceAllowance(
    outcomeTokenAddress, 
    proxyAddress, 
    exchangeAddress, 
    provider
  );
  return hasFundsAndAllowance(requiredSharesMicro, ba);
}
