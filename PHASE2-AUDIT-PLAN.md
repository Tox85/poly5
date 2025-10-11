# 🔬 PHASE 2 : AUDIT APPROFONDI - PLAN D'ACTION

**Date**: 2025-10-11  
**Objectif**: Code et architecture de qualité professionnelle maximale  
**Méthode**: Analyse ligne par ligne + quarantaine + validation

---

## 📊 PROBLÈMES IDENTIFIÉS PAR KNIP

### 🔴 CRITIQUE - Scripts avec imports cassés (5 fichiers)
**Impact**: Ces scripts ne compilent plus depuis la suppression de `customClob.ts`

1. `scripts/sync-inventory.ts` - Import `customClob`
2. `scripts/cleanup.ts` - Import `customClob`
3. `scripts/status.ts` - Import `customClob` (déjà archivé partiellement)
4. `scripts/close-orders.ts` - Import `customClob`
5. `scripts/test-auth.ts` - Import `customClob`

**Action**: Migrer vers `polySDK` ou archiver si non critiques

---

### 🟡 EXPORTS NON UTILISÉS (9 exports)

#### `src/config.ts`
1. ❌ `CHAIN_ID` (ligne 5) - Non utilisé
2. ❌ `SPREAD_MULTIPLIER_LOW` (ligne 37) - Dupliqué avec `MIN_SPREAD_MULTIPLIER`
3. ❌ `SPREAD_MULTIPLIER_HIGH` (ligne 38) - Dupliqué avec `MAX_SPREAD_MULTIPLIER`

#### `src/risk/solvency.ts`
4. ❌ `hasFundsAndAllowance` (ligne 28) - Fonction non utilisée

#### `src/lib/amounts.ts`
5. ❌ `toMicro` (ligne 11) - Fonction non utilisée

#### `src/risk/sizing.ts`
6. ❌ `calculateMaxSafeSize` (ligne 70) - Fonction non utilisée
7. ❌ `calculateMaxSafeSizeWithInventory` (ligne 87) - Fonction non utilisée

#### `src/clients/gamma.ts`
8. ❌ `fetchOpenTradableMarkets` (ligne 27) - Fonction non utilisée

#### `src/data/book.ts`
9. ❌ Type `Top` (ligne 7) - Type non utilisé

---

### 🟢 TYPES NON UTILISÉS (4 types)

1. ❌ `BalanceAllowance` dans `src/risk/solvency.ts`
2. ❌ `Side` dans `src/lib/amounts.ts`
3. ❌ `OrderEvent` dans `src/ws/userFeed.ts`
4. ❌ `Trade` et `PnLSummary` dans `src/metrics/pnl.ts`

---

### 🔵 DÉPENDANCES NON UTILISÉES

1. ❌ `@ethersproject/providers` - Peut-être indirecte via `ethers`
2. ⚠️ `eslint-plugin-import` - DevDep, à garder pour le linting

---

### 📁 SCRIPTS SCRIPTS NON CRITIQUES (6 fichiers)

Scripts qui ne font pas partie du flow principal :
1. `scripts/check-real-balance.ts`
2. `scripts/healthcheck.ts`
3. `scripts/monitor-markets.ts`
4. `scripts/reset-inventory.ts`
5. `scripts/sync-real-inventory.ts`
6. `scripts/transfer-usdc-from-proxy.ts`

**Action**: Vérifier utilité, potentiellement archiver

---

## 🎯 PLAN D'EXÉCUTION

### PHASE 2A : CORRECTION DES IMPORTS CASSÉS
**Priorité**: 🔴 CRITIQUE
**Durée estimée**: 30 min

1. Analyser chaque script avec import `customClob`
2. Si critique pour maintenance → Migrer vers `polySDK`
3. Si non critique → Archiver dans `tools/.graveyard/scripts/`
4. Rebuild + vérifier 0 erreur

---

### PHASE 2B : NETTOYAGE DES EXPORTS INUTILISÉS
**Priorité**: 🟡 IMPORTANT
**Durée estimée**: 45 min

Pour chaque export identifié :
1. Vérifier dans tout le codebase (grep récursif)
2. Vérifier dans les scripts (même archivés)
3. Si 0 utilisation → Commenter avec `// UNUSED:` + date
4. Déplacer dans un fichier `.unused` temporaire
5. Rebuild + smoke test
6. Si OK → Supprimer définitivement

---

### PHASE 2C : ANALYSE LIGNE PAR LIGNE DES FICHIERS CORE
**Priorité**: 🔵 QUALITÉ
**Durée estimée**: 2h

Pour chaque fichier du flow principal :

#### 1. `src/index.ts` (245 lignes)
- [ ] Imports inutilisés
- [ ] Variables non utilisées
- [ ] Commentaires obsolètes
- [ ] Logique redondante
- [ ] Potentiel d'optimisation

#### 2. `src/marketMaker.ts` (~1640 lignes)
- [ ] Imports inutilisés
- [ ] Méthodes privées non appelées
- [ ] Code dupliqué
- [ ] Logs excessifs
- [ ] Complexité cyclomatique

#### 3. `src/clients/polySDK.ts` (265 lignes)
- [ ] Méthodes non utilisées
- [ ] Paramètres inutiles
- [ ] Documentation manquante

#### 4. `src/ws/marketFeed.ts` (252 lignes)
- [ ] Gestion d'erreurs
- [ ] Reconnexion
- [ ] Mémoire leaks potentiels

#### 5. `src/ws/userFeed.ts`
- [ ] Gestion d'erreurs
- [ ] Event listeners cleanup

#### 6. `src/inventory.ts` (343 lignes)
- [ ] Logique redondante
- [ ] Optimisation persistance

#### 7. `src/data/discovery.ts`
- [ ] Logique de filtrage
- [ ] Performance

#### 8. `src/data/book.ts`
- [ ] Gestion d'erreurs
- [ ] Retry logic

#### 9. `src/risk/solvency.ts`
- [ ] Fonctions inutilisées (identifiées)

#### 10. `src/risk/sizing.ts`
- [ ] Fonctions inutilisées (identifiées)

#### 11. `src/lib/amounts.ts`
- [ ] Fonctions inutilisées (identifiées)

#### 12. `src/lib/round.ts`
- [ ] Précision des arrondis

#### 13. `src/lib/erc1155.ts`
- [ ] Interactions blockchain

#### 14. `src/allowanceManager.ts`
- [ ] Logique d'approbation

#### 15. `src/closeOrders.ts`
- [ ] Logique d'annulation

#### 16. `src/metrics/pnl.ts`
- [ ] Calculs PnL
- [ ] Types inutilisés

#### 17. `src/config.ts`
- [ ] Variables inutilisées (identifiées)
- [ ] Doublons (identifiés)

---

### PHASE 2D : OPTIMISATIONS ARCHITECTURALES
**Priorité**: 🟢 AMÉLIORATION
**Durée estimée**: 1h

1. **Structure des dossiers**
   - Vérifier cohérence
   - Regrouper logiques similaires

2. **Gestion d'erreurs**
   - Standardiser try/catch
   - Error types personnalisés

3. **Logging**
   - Niveaux cohérents
   - Pas de spam

4. **Performance**
   - Éviter les appels API redondants
   - Cache intelligent

5. **Tests**
   - Coverage critique
   - Smoke tests étendus

---

## 🛡️ GARDE-FOUS

### Avant chaque suppression :
1. ✅ Grep récursif dans `src/` et `scripts/`
2. ✅ Vérifier dans les types TypeScript
3. ✅ Commenter d'abord, puis déplacer
4. ✅ Rebuild sans erreurs
5. ✅ Smoke test validé
6. ✅ Git commit intermédiaire

### Tests de régression :
```bash
# Après chaque modification majeure
npm run build          # 0 erreur TS
npm run smoke          # 25s sans crash
npm start > test.log   # 60s + vérifier logs
```

---

## 📈 MÉTRIQUES CIBLES

| Métrique | Actuel | Cible | Amélioration |
|----------|--------|-------|--------------|
| Fichiers src/ | 77 | 65-70 | -10% |
| Exports inutilisés | 9 | 0 | -100% |
| Imports cassés | 5 | 0 | -100% |
| Code coverage | ? | >80% | +80% |
| Cyclomatic complexity | ? | <15 | TBD |
| Lignes de code | ~6000 | ~5500 | -8% |

---

## 🎯 LIVRABLES PHASE 2

1. ✅ Scripts corrigés ou archivés
2. ✅ 0 export inutilisé
3. ✅ 0 import cassé
4. ✅ Architecture simplifiée
5. ✅ Documentation à jour
6. ✅ Smoke tests validés
7. ✅ Rapport d'audit ligne par ligne

---

**Approche** : Chirurgicale, méthodique, sans précipitation  
**Validation** : À chaque étape, pas seulement à la fin  
**Garantie** : Flow principal intact, 0 régression

