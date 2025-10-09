# 📜 Scripts Utilitaires - Bot Market Maker Polymarket

Ce dossier contient tous les scripts utilitaires pour gérer, tester et monitorer le bot.

## 🔍 Scripts de Vérification

### `test-auth.ts`
Teste l'authentification CLOB et affiche les informations du compte.

```bash
npx tsx scripts/test-auth.ts
```

**Affiche :**
- ✅ Variables d'environnement
- 📍 Adresse EOA et Maker (proxy)
- 💰 Balances et allowances
- 📝 Ordres ouverts

---

### `check-real-balance.ts`
Vérifie le solde USDC et l'allowance on-chain avec analyse détaillée.

```bash
npx tsx scripts/check-real-balance.ts
```

**Affiche :**
- 💰 Solde USDC réel
- 📊 Ordres ouverts (top 5)
- ⚠️ Alertes si solde faible
- 🎯 Recommandations d'action

---

### `status.ts`
Vue complète du statut du market maker.

```bash
npm run status
# ou
npx tsx scripts/status.ts
```

**Affiche :**
- 💰 Allowances et balances USDC
- 📦 Inventaire détaillé par token
- 📈 Marchés actifs et ordres par marché
- 📊 Résumé global
- 💡 Recommandations

---

### `healthcheck.ts`
Vérification complète de la configuration Polymarket.

```bash
npx tsx scripts/healthcheck.ts
```

**Vérifie :**
- ✅ Variables d'environnement
- ✅ Wallet EOA
- ✅ Authentification L2 (HMAC)
- ✅ Quantisation des montants
- ✅ Soldes et allowances on-chain

---

## 📦 Scripts de Gestion d'Inventaire

### `sync-real-inventory.ts`
Synchronise l'inventaire avec les positions réelles on-chain (tokens connus).

```bash
npx tsx scripts/sync-real-inventory.ts
```

**Actions :**
- 🔄 Lecture des positions blockchain
- 💾 Mise à jour du fichier `.inventory.json`
- 📊 Affichage du résumé YES/NO

---

### `sync-inventory.ts`
Synchronisation générale de l'inventaire.

```bash
npm run sync-inventory
# ou
npx tsx scripts/sync-inventory.ts
```

**Actions :**
- 🔄 Synchronise tous les tokens de l'inventaire
- 💾 Sauvegarde dans `.inventory.json`

---

### `reset-inventory.ts`
Réinitialise l'inventaire en synchronisant avec la blockchain.

```bash
npx tsx scripts/reset-inventory.ts
```

**Actions :**
- 📊 Charge l'inventaire actuel
- 🔗 Synchronise avec la blockchain
- 💾 Sauvegarde l'inventaire réel
- ✅ Nettoie les positions obsolètes

---

## 📝 Scripts de Gestion d'Ordres

### `close-orders.ts`
Ferme tous les ordres ouverts (ou par token spécifique).

```bash
# Fermer tous les ordres
npm run close-orders
# ou
npx tsx scripts/close-orders.ts

# Mode simulation (dry-run)
npm run close-orders:dry
# ou
npx tsx scripts/close-orders.ts --dry-run

# Fermer pour un token spécifique
npx tsx scripts/close-orders.ts --token-id 110231926589098351804293174455681788984678095258631881563984268486591441074567
```

**Options :**
- `--dry-run` : Simule la fermeture sans exécuter
- `--token-id <ID>` : Ferme uniquement les ordres pour un token

---

## 📊 Scripts de Monitoring

### `monitor-markets.ts`
Affiche les marchés actifs avec leurs détails (spread, volume, prix).

```bash
npx tsx scripts/monitor-markets.ts
```

**Affiche :**
- 📊 Top marchés par volume
- 💰 Volume 24h
- 📈 Spreads YES et NO
- 💵 Mid-price et best bid/ask
- 🎯 Nombre de marchés qui seront tradés

---

### `cleanup.ts`
Annule tous les ordres et nettoie l'inventaire.

```bash
# Annuler les ordres seulement
npx tsx scripts/cleanup.ts

# Annuler les ordres ET réinitialiser l'inventaire
npx tsx scripts/cleanup.ts --reset-inventory
```

**Actions :**
- 📝 Annule tous les ordres ouverts
- 📦 Affiche l'inventaire actuel
- 🔄 Réinitialise l'inventaire (si `--reset-inventory`)
- 📊 Affiche le statut final

---

## 🧪 Scripts de Test

### `test-websocket.ts`
Teste la connexion WebSocket temps réel.

```bash
npx tsx scripts/test-websocket.ts
```

**Teste :**
- 🔌 Connexion WebSocket
- 📊 Réception des prix temps réel
- ✅ Validation des données

---

## 📋 Guide d'Utilisation Rapide

### Avant de démarrer le bot
```bash
# 1. Vérifier la configuration
npx tsx scripts/healthcheck.ts

# 2. Vérifier le solde
npx tsx scripts/check-real-balance.ts

# 3. Synchroniser l'inventaire
npx tsx scripts/sync-real-inventory.ts

# 4. Voir les marchés disponibles
npx tsx scripts/monitor-markets.ts
```

### Pendant que le bot tourne
```bash
# Voir le statut complet
npm run status

# Vérifier le solde
npx tsx scripts/check-real-balance.ts
```

### Arrêter le bot proprement
```bash
# 1. Fermer tous les ordres (simulation)
npm run close-orders:dry

# 2. Si OK, fermer réellement
npm run close-orders

# 3. Nettoyer complètement
npx tsx scripts/cleanup.ts --reset-inventory
```

---

## 🔧 Dépannage

### "Solde USDC insuffisant"
```bash
npx tsx scripts/check-real-balance.ts
# Vérifier le solde et déposer plus d'USDC si nécessaire
```

### "Inventaire désynchronisé"
```bash
npx tsx scripts/sync-real-inventory.ts
# ou
npx tsx scripts/reset-inventory.ts
```

### "Ordres bloqués"
```bash
# Voir les ordres
npx tsx scripts/test-auth.ts

# Fermer tous les ordres
npm run close-orders
```

### "Erreur d'authentification"
```bash
npx tsx scripts/healthcheck.ts
# Vérifier que toutes les variables d'environnement sont correctes
```

---

## 📝 Notes

- Tous les scripts utilisent les variables d'environnement du fichier `.env`
- Les scripts avec `tsx` peuvent aussi être exécutés avec `ts-node`
- Utilisez toujours `--dry-run` pour tester avant d'exécuter des actions destructives
- Le fichier `.inventory.json` est mis à jour automatiquement par les scripts de synchronisation

---

**Dernière mise à jour :** Octobre 2025

