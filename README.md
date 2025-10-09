# 🤖 Bot de Market Making Polymarket

Bot de market making automatisé pour la plateforme Polymarket, écrit en TypeScript. Le bot place des ordres d'achat et de vente pour capturer le spread sur les marchés de prédiction.

## ✨ Fonctionnalités

- 🎯 **Market making automatisé** sur les marchés Polymarket les plus liquides
- 📊 **Détection temps réel** via WebSocket des variations de prix
- 💰 **Gestion intelligente** du capital et de l'inventaire
- 🔄 **Ajustement dynamique** des prix selon les conditions du marché
- 📈 **Filtrage intelligent** des marchés par volume et spread
- ⚡ **Réactivité** : Remplace les ordres si mouvement de prix >0.1¢
- 🛡️ **Sécurité** : Vérifications on-chain et gestion des limites

## 🚀 Installation

```bash
# Installer les dépendances
npm install

# Copier le fichier d'exemple d'environnement
cp env.example .env

# Éditer .env avec vos credentials
nano .env
```

## ⚙️ Configuration

### Variables d'environnement requises

Copiez `env.example` vers `.env` et configurez :

```env
# Identifiants API et Wallet Polymarket
PRIVATE_KEY=votre_cle_privee_polygon
CLOB_API_KEY=votre_api_key_polymarket
CLOB_API_SECRET=votre_api_secret
CLOB_PASSPHRASE=votre_passphrase
POLY_PROXY_ADDRESS=votre_adresse_proxy

# Paramètres du bot
DRY_RUN=false                      # true pour tester sans ordres réels
MAX_ACTIVE_MARKETS=2               # Nombre de marchés à trader
NOTIONAL_PER_ORDER_USDC=1.5        # Montant USDC par ordre
TARGET_SPREAD_CENTS=3              # Spread cible en centimes
MIN_VOLUME_USDC=5000               # Volume minimum 24h requis

# Limites d'inventaire
MAX_INVENTORY_YES=500              # Maximum shares YES par token
MAX_INVENTORY_NO=500               # Maximum shares NO par token

# Adaptation automatique
AUTO_ADJUST_NOTIONAL=true          # Ajuster le notional selon le solde
PRICE_CHANGE_THRESHOLD=0.001       # Seuil de mouvement (0.1¢)
MAX_DISTANCE_FROM_MID=0.05         # Distance max du mid-price (5¢)
```

## 📝 Utilisation

### Démarrage du bot

```bash
npm start
```

### Mode développement (avec rechargement)

```bash
npm run dev
```

### Scripts utiles

```bash
# Compiler TypeScript
npm run build

# Tester l'authentification
npm run test:auth

# Voir les ordres ouverts
npx tsx scripts/test-auth.ts

# Synchroniser l'inventaire
npx tsx scripts/sync-inventory.ts

# Fermer tous les ordres
npm run close-orders

# Mode simulation (sans fermer)
npm run close-orders:dry
```

## 🎯 Stratégie de Trading

Le bot implémente une stratégie de market making sophistiquée :

### 1. **Sélection des marchés**
- Scan de tous les marchés Gamma actifs
- Filtre par volume minimum (défaut : 5000 USDC/24h)
- Priorité aux marchés spécifiques (ex: Trump Nobel)
- Limite au nombre configuré (défaut : 2 marchés)

### 2. **Détection temps réel**
- WebSocket pour mises à jour instantanées best bid/ask
- Calcul du mid-price actuel
- Détection des mouvements >0.1¢
- Remplacement automatique des ordres

### 3. **Calcul des prix**
- **Bid** : Exactement au best bid (ou +1 tick)
- **Ask** : Exactement au best ask (ou -1 tick)
- **Protection** : Distance max 5¢ du mid-price
- **Validation** : Vérification cross-the-book

### 4. **Calcul des tailles**
- **BUY** : Adapté au capital disponible
- **SELL** : Arrondi vers le bas (floor), limité par inventaire
- **Minimum** : 5 shares (exigence Polymarket)
- **Auto-ajustement** : Augmentation du notional pour prix élevés

### 5. **Vérifications de solvabilité**
- **USDC** : Balance et allowance vérifiées à chaque ordre
- **Tokens ERC-1155** : Vérification inventaire on-chain
- **Mise à jour auto** : Synchronisation après chaque trade

### 6. **Gestion des risques**
- Limites d'inventaire par token (YES/NO)
- Réserve de capital (10% ou 0.5 USDC min)
- Skip si spread trop serré ou capital insuffisant
- Annulation si conditions non remplies

## 📊 Architecture

```
src/
├── index.ts              # Point d'entrée principal
├── config.ts             # Configuration centralisée
├── marketMaker.ts        # Logique de market making
├── inventory.ts          # Gestion de l'inventaire
├── allowanceManager.ts   # Gestion des allowances
├── closeOrders.ts        # Fermeture d'ordres
├── clients/
│   ├── customClob.ts     # Client CLOB personnalisé
│   └── gamma.ts          # Client API Gamma
├── data/
│   ├── book.ts           # Carnets d'ordres
│   └── discovery.ts      # Découverte de marchés
├── ws/
│   └── marketFeed.ts     # WebSocket temps réel
├── risk/
│   ├── sizing.ts         # Calcul des tailles
│   └── solvency.ts       # Vérifications de solvabilité
└── lib/
    ├── amounts.ts        # Quantification des montants
    └── erc1155.ts        # Interactions ERC-1155
```

## 🔍 Monitoring

Le bot génère des logs détaillés au format JSON :

- 🚀 Démarrage et connexions
- 📊 Découverte et sélection des marchés
- 💰 Vérifications USDC et allowances
- 📦 Synchronisation de l'inventaire
- 🔌 Connexion WebSocket et prix temps réel
- ✅ Placement d'ordres (succès)
- ❌ Erreurs et avertissements
- ⚡ Détection de mouvements de prix

### Exemples de logs

**Ordre placé avec succès :**
```json
{
  "level": 30,
  "msg": "✅ BUY order placed successfully",
  "bidId": "0xacc0457a...",
  "bidPrice": "0.0640",
  "size": 23.44,
  "newInventory": 171.38
}
```

**Ajustement automatique du notional :**
```json
{
  "level": 20,
  "msg": "📊 Notional increased to meet minimum shares requirement",
  "price": "0.9340",
  "minShares": 5,
  "oldNotional": "1.50",
  "newNotional": "4.67"
}
```

## ⚠️ Sécurité et Avertissements

### ✅ Bonnes pratiques

- Ne **jamais** committer le fichier `.env`
- Garder vos clés privées **sécurisées**
- Commencer avec `DRY_RUN=true` pour tester
- Utiliser de **petits montants** au début
- **Surveiller** le bot régulièrement
- Définir des **limites strictes** d'inventaire

### ⚠️ Risques

- Le market making comporte des risques de perte
- Les prix peuvent évoluer rapidement
- L'inventaire peut devenir déséquilibré
- Les frais de transaction s'accumulent
- La liquidité peut varier selon les marchés

### 🛡️ Protections intégrées

- ✅ Vérification on-chain avant chaque SELL
- ✅ Réserve de capital pour éviter le blocage
- ✅ Limites d'inventaire configurables
- ✅ Filtrage des données corrompues (WebSocket)
- ✅ Gestion automatique des erreurs
- ✅ Arrêt propre avec fermeture des ordres

## 🐛 Résolution de problèmes

### Problème : "Size lower than the minimum: 5"

**Solution :** Le bot ajuste maintenant automatiquement le notional pour respecter le minimum de 5 shares. Si l'erreur persiste, augmentez `NOTIONAL_PER_ORDER_USDC`.

### Problème : "not enough USDC balance"

**Solutions :**
1. Activez `AUTO_ADJUST_NOTIONAL=true`
2. Réduisez `NOTIONAL_PER_ORDER_USDC`
3. Vérifiez votre solde : `npx tsx scripts/check-real-balance.ts`
4. Déposez plus d'USDC sur votre proxy

### Problème : "WebSocket disconnected"

**Solution :** Le bot reconnecte automatiquement avec backoff exponentiel (jusqu'à 10 tentatives).

### Problème : Inventaire désynchronisé

**Solution :**
```bash
# Synchroniser depuis la blockchain
npx tsx scripts/sync-real-inventory.ts

# Ou réinitialiser complètement
npx tsx scripts/reset-inventory.ts
```

## 📈 Performance

- ⚡ **Réactivité** : <1 seconde pour détecter et réagir aux mouvements
- 🎯 **Précision** : 100% de respect des contraintes Polymarket
- 💰 **Capital efficient** : Ajustement automatique selon le solde
- 🔄 **Fiabilité** : Reconnexion automatique et gestion d'erreurs

## 📚 Documentation API

- [Documentation Polymarket](https://docs.polymarket.com)
- [API CLOB](https://docs.polymarket.com/api/clob)
- [Gamma Markets](https://gamma-api.polymarket.com)

## 📄 Licence

ISC

---

**⚠️ Disclaimer :** Ce bot est fourni à des fins éducatives. Utilisez-le à vos propres risques. Les auteurs ne sont pas responsables des pertes financières.

**🎉 Bot opérationnel et testé !** Dernière mise à jour : Octobre 2025
