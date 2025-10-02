# Bot de Market Making Polymarket

Un bot de market making automatisé pour la plateforme Polymarket, écrit en TypeScript.

## Fonctionnalités

- 🤖 Market making automatisé sur les marchés Polymarket
- 📊 Surveillance en temps réel via WebSocket
- 💰 Gestion automatique des ordres d'achat et de vente
- 📈 Filtrage intelligent des marchés par volume et écart
- 🔄 Ajustement dynamique des prix selon les conditions de marché

## Installation

1. Clonez ce dépôt
2. Installez les dépendances :
```bash
npm install
```

3. Configurez vos identifiants dans un fichier `.env` (copiez depuis `env.example`) :
```bash
cp env.example .env
```

4. Éditez le fichier `.env` avec vos vraies valeurs :
   - `PRIVATE_KEY` : Votre clé privée du wallet Polygon
   - `CLOB_API_KEY`, `CLOB_API_SECRET`, `CLOB_PASSPHRASE` : Vos identifiants API Polymarket
   - `POLY_PROXY_ADDRESS` : L'adresse de votre proxy Polymarket

## Configuration

### Variables d'environnement requises

```env
# Identifiants API et Wallet Polymarket
PRIVATE_KEY=your_polygon_wallet_private_key
CLOB_API_KEY=your_polymarket_api_key
CLOB_API_SECRET=your_polymarket_api_secret
CLOB_PASSPHRASE=your_polymarket_api_passphrase

# Adresse du proxy Polymarket
POLY_PROXY_ADDRESS=your_polymarket_proxy_address

# Paramètres du bot
MAX_MARKETS=2              # Nombre de marchés à trader
QUOTE_USDC_PER_SIDE=2      # Montant USDC par côté (ex: 2 USDC sur bid et ask)
TARGET_SPREAD=0.02         # Écart cible en USDC (ex: $0.02)
MIN_24H_VOLUME=1000        # Volume minimum 24h en USDC
```

## Utilisation

### Démarrage du bot
```bash
npm start
```

### Mode développement (avec rechargement automatique)
```bash
npm run dev
```

### Compilation TypeScript
```bash
npm run build
```

## Comment ça fonctionne

1. **Récupération des marchés** : Le bot récupère tous les marchés actifs depuis l'API Polymarket
2. **Filtrage** : Il sélectionne les marchés qui répondent aux critères de volume et d'écart
3. **Market Making** : Pour chaque marché sélectionné, il :
   - Se connecte au WebSocket pour recevoir les mises à jour en temps réel
   - Place des ordres d'achat et de vente à l'écart cible
   - Ajuste automatiquement les ordres si le marché change
   - Annule les ordres si l'écart devient trop étroit

## Stratégie de trading

Le bot utilise une stratégie simple mais efficace :

- **Écart cible** : Maintient un écart de 2 centimes (configurable)
- **Taille des ordres** : 2 USDC par côté par défaut
- **Gestion des risques** : Annule les ordres si l'écart devient trop étroit
- **Réactivité** : S'ajuste en temps réel aux changements de marché

## Structure du projet

```
src/
├── config.ts          # Configuration et variables d'environnement
├── markets.ts         # Récupération et filtrage des marchés
├── marketMaker.ts     # Logique de market making pour un marché
└── main.ts           # Point d'entrée principal
```

## Sécurité

⚠️ **Important** : 
- Ne committez JAMAIS votre fichier `.env` 
- Gardez vos clés privées sécurisées
- Testez d'abord avec de petits montants
- Surveillez le bot en permanence

## Support

Pour toute question ou problème, consultez la documentation Polymarket :
- [Documentation API](https://docs.polymarket.com)
- [Guide d'authentification](https://docs.polymarket.com/authentication)

## Licence

ISC
