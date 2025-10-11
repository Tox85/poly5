# 🤖 Polymarket Market Making Bot

Bot de market making automatisé pour Polymarket utilisant le SDK officiel.

---

## 🚀 Démarrage Rapide

### 1. Installation

```bash
npm install
```

### 2. Configuration

Copiez `.env.example` vers `.env` et remplissez vos credentials :

```bash
cp env.example .env
```

### Variables OBLIGATOIRES (5) :
- `PRIVATE_KEY` - Clé privée de votre EOA (format: 0x + 64 hex)
- `CLOB_API_KEY` - Clé API CLOB Polymarket (UUID)
- `CLOB_API_SECRET` - Secret API CLOB (string hex)
- `CLOB_PASSPHRASE` - Passphrase API CLOB (string hex)
- `POLY_PROXY_ADDRESS` - Adresse de votre proxy Polymarket (0x + 40 hex)

### Variables RECOMMANDÉES (config optimale) :
- `MIN_VOLUME_USDC=50000` - Volume minimum 24h
- `MIN_SPREAD_CENTS=4` - Spread minimum (4¢ = rentable)
- `MAX_SPREAD_CENTS=10` - Spread maximum
- `TARGET_SPREAD_CENTS=4` - Spread cible
- `TICK_IMPROVEMENT=1` - Amélioration de prix (priorité de file) ⚡
- `NOTIONAL_PER_ORDER_USDC=1.5` - Montant par ordre
- `MAX_ACTIVE_MARKETS=2` - Nombre de marchés

**Toutes les autres variables (33)** ont des valeurs par défaut intelligentes.  
Voir `env.example` pour la liste complète des 44 variables disponibles.

### 3. Lancer le Bot

```bash
npm start
```

---

## 📊 Configuration

Principales variables (voir `env.example` pour la liste complète) :

### Marchés
- `MIN_VOLUME_USDC` - Volume minimum 24h (défaut: 50000)
- `MIN_SPREAD_CENTS` - Spread minimum requis (défaut: 3)
- `MAX_SPREAD_CENTS` - Spread maximum accepté (défaut: 10)
- `MAX_ACTIVE_MARKETS` - Nombre de marchés actifs (défaut: 2)

### Ordres
- `TARGET_SPREAD_CENTS` - Spread cible pour ordres (défaut: 4)
- `NOTIONAL_PER_ORDER_USDC` - Montant par ordre (défaut: 1.5)
- `MAX_INVENTORY` - Inventaire maximum par token (défaut: 500)

### Sécurité
- `DRY_RUN` - Mode test sans ordres réels (défaut: false)

---

## 🏗️ Architecture

```
src/
├── index.ts              # Point d'entrée
├── marketMaker.ts        # Logique principale de market making
├── config.ts             # Configuration centralisée (44 variables)
│
├── clients/              # Clients API
│   ├── polySDK.ts        # SDK Polymarket officiel
│   └── gamma.ts          # API Gamma (discovery)
│
├── config/               # Configuration avancée
│   └── schema.ts         # Validation Zod (optionnel)
│
├── ws/                   # WebSocket temps réel
│   ├── marketFeed.ts     # Prix en temps réel (market channel)
│   └── userFeed.ts       # Fills en temps réel (user channel)
│
├── data/                 # Découverte & order books
│   ├── discovery.ts      # Découverte des marchés
│   └── book.ts           # Snapshots des carnets d'ordres
│
├── risk/                 # Gestion des risques
│   ├── solvency.ts       # Vérifications USDC/balance
│   └── sizing.ts         # Calcul tailles d'ordres
│
├── lib/                  # Bibliothèques utilitaires
│   ├── quote-guard.ts    # Protection post-only + tick improvement ⚡
│   ├── math.ts           # Fonctions mathématiques (canon)
│   ├── amounts.ts        # Quantisation Polymarket
│   ├── round.ts          # Arrondis précis
│   └── erc1155.ts        # Lecture balances ERC-1155
│
├── inventory.ts          # Gestion inventaire YES/NO
├── allowanceManager.ts   # Gestion allowances USDC
├── closeOrders.ts        # Fermeture des ordres
│
└── metrics/
    └── pnl.ts            # Tracking PnL et métriques
```

---

## 🔧 Scripts Disponibles

```bash
npm start              # Lancer le bot
npm run build          # Compiler TypeScript
npm run dev            # Mode développement (hot reload)

npm run check-balances # Vérifier balances USDC
npm run find-proxy     # Trouver adresse proxy
npm run test-poly-sdk  # Tester SDK Polymarket
npm run test-websocket # Tester WebSocket
```

---

## 📈 Flux de Fonctionnement

### Au Démarrage
1. **Validation** - Vérification configuration .env
2. **Découverte** - Analyse 8000+ marchés Polymarket (API Gamma)
3. **Filtrage** - Volume >50K$ + spread 4-10¢ (configurable)
4. **Scoring** - Classement par volume + spread
5. **Sélection** - Top 2 marchés les plus opportuns
6. **Init USDC** - Vérification balance/allowance
7. **Sync Inventaire** - Lecture positions blockchain
8. **Récupération Ordres** - Charge ordres déjà ouverts (nouveau!)
9. **WebSocket** - Connexion feeds market + user

### En Continu
1. **Prix Update** - Réception prix temps réel (WebSocket)
2. **Quote Guards** - Calcul prix avec tick improvement (+1 tick)
3. **Validation** - Vérification post-only (pas de cross)
4. **Placement** - Ordres BUY/SELL avec logs forensics
5. **Fills** - Mise à jour inventaire en temps réel
6. **Replacement** - Si prix bouge/pas compétitif/TTL

### Toutes les 60s
- **Réconciliation ordres** - Compare cache ↔ API REST
- **Métriques PnL** - Log des performances

### Toutes les 2min
- **Sync inventaire** - Compare local ↔ blockchain
- **Détection divergences** - Correction automatique

---

## ⚙️ Fonctionnalités

### ✅ Market Making Intelligent
- Placement automatique d'ordres BUY/SELL
- **Quote Guards** : Protection post-only + amélioration de prix ⚡
- **Tick Improvement** : Améliore le prix de 1 tick (priorité de file)
- Spread dynamique adaptatif
- Replacement automatique (prix bougé, pas compétitif, TTL)
- Stratégie de parité YES/NO

### ✅ Réconciliation Robuste
- **Ordres** : Sync API REST toutes les 60s (détecte ordres annulés/remplis)
- **Inventaire** : Sync blockchain toutes les 2min (source de vérité)
- **Détection divergences** : Logs automatiques des incohérences
- **Recovery** : Charge ordres existants au démarrage

### ✅ Gestion des Risques
- Vérifications de solvabilité avant chaque ordre
- Limites d'inventaire configurables (MAX_INVENTORY_YES/NO)
- Capital à risque plafonné (MAX_NOTIONAL_AT_RISK_USDC)
- Protection contre marchés inactifs (health check 3min)
- Validation des prix (distance du mid, cross-the-book)

### ✅ WebSocket Temps Réel
- **Market Feed** : Prix bid/ask en temps réel
- **User Feed** : Fills et ordres en temps réel
- Reconnexion automatique avec backoff exponentiel
- Détection des WebSocket gelés (watchdog)

### ✅ Métriques & Monitoring
- PnL en temps réel avec persistence
- Logs structurés JSON (pino)
- Tracking complet des trades
- Logs forensics pour debugging (event: place_attempt, order_ack, fill)

---

## 🛡️ Sécurité

### Authentification
- Signature EIP-712 pour ordres
- HMAC-SHA256 pour API REST
- Support proxy Polymarket (signatureType: 2)

### Validation
- Vérification des variables d'environnement au démarrage
- Validation optionnelle avec Zod (`USE_ZOD_VALIDATION=true`)
- Quantisation stricte (2 dec shares, 5 dec notional)

---

## 📊 Dépendances

### Production
- `@polymarket/clob-client` - SDK officiel Polymarket CLOB
- `@polymarket/order-utils` - Signature EIP-712 et types
- `ethers` - Interactions blockchain (RPC Polygon)
- `axios` - Client HTTP REST
- `dotenv` - Variables d'environnement
- `pino` - Logging JSON structuré haute performance
- `ws` - Client WebSocket temps réel

### Développement
- `typescript` - Compilateur TypeScript
- `ts-node` - Exécution directe TypeScript
- `@types/node` - Types Node.js
- `@types/ws` - Types WebSocket
- `zod` - Validation runtime optionnelle (USE_ZOD_VALIDATION=true)

---

## 📝 Fichiers Importants

- `.env` - Configuration secrète (**ne pas versionner**)
- `.inventory.json` - État de l'inventaire (généré automatiquement)
- `package.json` - Configuration npm
- `tsconfig.json` - Configuration TypeScript
- `env.example` - Template de configuration

---

## ⚠️ Notes

### Fonds Requis
- Minimum recommandé : **$50-100 USDC** sur le proxy
- Ajuster `NOTIONAL_PER_ORDER_USDC` selon vos fonds

### Rate Limiting
- Polymarket limite à ~10 req/sec
- Le bot utilise WebSocket pour minimiser les appels API
- Cooldown de replacement : 1.5s minimum

### Marchés
- Le bot sélectionne automatiquement les meilleurs marchés
- **Critères** : volume > 50K$ USDC, spread 4-10¢
- **Health check** : Toutes les 3 minutes (arrêt si inactif >5min)
- **Filtrage intelligent** : Exclut marchés fermés/résolus

### Tick Improvement (Nouveau ⚡)
- **TICK_IMPROVEMENT=1** : Améliore le prix de 1 tick (0.1¢)
- **Priorité de file** : Vos ordres passent AVANT les autres au même prix
- **Plus de fills** : Meilleure position dans le carnet d'ordres
- **Configurable** : 0=join-only, 1=recommandé, 2+=agressif

---

## 🎯 Support

Pour des questions ou des problèmes :
1. Vérifiez votre configuration `.env`
2. Vérifiez vos balances : `npm run check-balances`
3. Testez le SDK : `npm run test-poly-sdk`
4. Testez WebSocket : `npm run test-websocket`

---

## 📄 License

ISC

---

**Version** : 1.0.0  
**Dernière mise à jour** : 2025-10-12  
**Statut** : ✅ Production-ready  

---

## 🎯 Nouvelles Fonctionnalités (v1.0.0)

### ⚡ Quote Guards & Tick Improvement
- Protection post-only émulée (pas d'ordres marketables)
- Amélioration automatique de 1 tick (priorité de file)
- Validation robuste des prix (distance mid, cross-the-book)
- Logs forensics complets pour debugging

### 🔄 Réconciliation Robuste
- Récupération ordres existants au démarrage
- Sync API REST toutes les 60s (source de vérité)
- Sync blockchain toutes les 2min (inventaire réel)
- Détection automatique des divergences

### 📊 Filtrage des Marchés Amélioré
- **MIN_SPREAD_CENTS** : Exclut marchés trop serrés (<4¢)
- **MAX_SPREAD_CENTS** : Exclut marchés trop larges (>10¢)
- **MIN_VOLUME_USDC** : Seulement marchés liquides (>50K$)

---

## 📁 Structure du Projet Nettoyée

Fichiers essentiels uniquement :
- **20 fichiers TypeScript** dans `src/`
- **7 répertoires** bien organisés
- **5 scripts utilitaires** dans `scripts/`
- **0 fichier inutile** - Projet clean ✨

Pour voir la structure complète : `PROJECT-STRUCTURE.md`
