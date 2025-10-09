# 🚀 Guide de Déploiement Railway - Polymarket Bot

## ⚡ Déploiement Rapide (5 minutes)

### Étape 1 : Créer un projet Railway
1. Allez sur [railway.app](https://railway.app)
2. Connectez-vous avec GitHub
3. Cliquez sur "New Project"
4. Sélectionnez "Deploy from GitHub repo"
5. Choisissez 

### Étape 2 : Configurer les variables d'environnement

Dans l'onglet "Variables" de Railway, ajoutez :

#### 🔐 **Variables obligatoires :**
```
PRIVATE_KEY=0x...
CLOB_API_KEY=...
CLOB_API_SECRET=...
CLOB_PASSPHRASE=...
POLY_PROXY_ADDRESS=0x...
RPC_URL=https://polygon-mainnet.infura.io/v3/...
CHAIN_ID=137
```

#### ⚙️ **Variables de configuration (optionnelles, valeurs par défaut déjà bonnes) :**
```
MAX_ACTIVE_MARKETS=1
NOTIONAL_PER_ORDER_USDC=0.75
MIN_NOTIONAL_SELL_USDC=1.00
MAX_SELL_PER_ORDER_SHARES=50
BASE_TARGET_SPREAD=0.0020
PRICE_CHANGE_THRESHOLD=0.001
ORDER_TTL_MS=30000
REPLACE_COOLDOWN_MS=1500
MAX_INVENTORY_PER_SIDE=500
MAX_NOTIONAL_AT_RISK_USDC=15
INVENTORY_SKEW_LAMBDA=0.0
LOG_LEVEL=info
```

### Étape 3 : Déployer

1. Railway va automatiquement :
   - ✅ Installer les dépendances (`npm ci`)
   - ✅ Compiler TypeScript (`npm run build`)
   - ✅ Démarrer le bot (`npm start`)

2. Surveillez les logs dans l'onglet "Logs"

### Étape 4 : Vérification

Après le déploiement, vérifiez dans les logs :
- ✅ `"ENV OK - All required environment variables are present"`
- ✅ `"Market WebSocket connected"`
- ✅ `"User WebSocket connected"`
- ✅ `"Token synchronized from on-chain"`
- ✅ `"BUY/SELL order POSTED"`

## 📊 Monitoring sur Railway

Les logs montreront automatiquement :
- Ordres placés/annulés
- Fills reçus
- PnL metrics toutes les 60s
- Capital à risque
- Synchronisation inventaire toutes les 120s

## 💰 Coût estimé

**Plan Railway Starter ($5/mois)** :
- 512 MB RAM ✅
- $5 de crédits inclus
- Parfait pour ce bot

**Plan Developer ($20/mois)** :
- Plus de resources si besoin d'échelle

## 🔧 Commandes utiles

```bash
# Voir les logs en temps réel
railway logs --follow

# Redémarrer le service
railway restart

# Voir les variables d'env
railway variables

# Se connecter au projet
railway link
```

## ⚠️ Notes importantes

1. **Wallet USDC** : Assurez-vous d'avoir du USDC sur Polygon
2. **Allowances** : Le bot gère automatiquement les allowances
3. **Inventory** : Synchronisé automatiquement depuis la blockchain
4. **Persistence** : Railway redémarre le bot automatiquement en cas d'erreur

## 🛑 Arrêt du bot

Pour arrêter temporairement le bot :
1. Dans Railway, allez dans "Settings"
2. Cliquez sur "Pause Deployment"

Pour le relancer :
1. Cliquez sur "Resume Deployment"

Le bot reprendra exactement où il en était (détection automatique des positions).

## 📈 Performance attendue

- **Latence** : ~100-200ms pour placer un ordre
- **Spreads capturés** : 0.1¢ - 0.5¢ par trade
- **Capital requis** : Minimum 10 USDC pour commencer
- **Fills par jour** : Variable selon la liquidité du marché

## 🐛 Dépannage

**Erreur "not enough balance/allowance"** :
- Vérifiez le solde USDC
- Le bot gère automatiquement les allowances USDC
- Pour les tokens CTF : approuvez manuellement si nécessaire

**Pas de fills** :
- Les spreads sont très serrés (join-only)
- Normal d'attendre plusieurs minutes entre les fills
- Le bot remplace automatiquement les ordres si le marché bouge

**UserFeed déconnecté** :
- Le bot se reconnecte automatiquement
- Backoff exponentiel en cas de problèmes répétés

---

**Le bot est prêt pour Railway ! 🚂**

