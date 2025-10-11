import { Wallet } from "ethers";

export type V5LikeSigner = {
  getAddress(): Promise<string>;
  _signTypedData(domain: any, types: any, value: any): Promise<string>;
  signMessage(message: string | Uint8Array): Promise<string>;
};

export function makeV5LikeSigner(privateKey: string): V5LikeSigner {
  const w = new Wallet(privateKey);
  return {
    getAddress: async () => w.address,
    _signTypedData: (domain: any, types: any, value: any) => w.signTypedData(domain, types, value),
    signMessage: (m: string | Uint8Array) => w.signMessage(m),
  };
}

// Fonction makeProxySigner supprimée - nous utilisons maintenant makeV5LikeSigner
// avec funderAddress dans ClobClient pour séparer authentification (EOA) et fonds (proxy)
