// tools/build-keep-list.ts
// Construit la KEEP-LIST des fichiers à conserver (statique ∪ dynamique)

import fs from 'fs';
import path from 'path';

console.log('📋 Building KEEP-LIST from audit data...\n');

// Charger les rapports d'audit
let knip: any = {};
let prune: string[] = [];
let cov: any = {};
let loaded: string[] = [];

try {
  knip = JSON.parse(fs.readFileSync('.audit/knip.json', 'utf8'));
  console.log('✅ Loaded knip.json');
} catch (e) {
  console.warn('⚠️  Could not load knip.json');
}

try {
  const pruneText = fs.readFileSync('.audit/ts-prune.txt', 'utf8');
  prune = pruneText.split('\n').filter(Boolean);
  console.log(`✅ Loaded ts-prune.txt (${prune.length} lines)`);
} catch (e) {
  console.warn('⚠️  Could not load ts-prune.txt');
}

try {
  cov = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'));
  console.log(`✅ Loaded coverage-final.json (${Object.keys(cov).length} files)`);
} catch (e) {
  console.warn('⚠️  Could not load coverage-final.json');
}

try {
  loaded = JSON.parse(fs.readFileSync('.audit/loaded-modules.json', 'utf8'));
  console.log(`✅ Loaded loaded-modules.json (${loaded.length} modules)\n`);
} catch (e) {
  console.warn('⚠️  Could not load loaded-modules.json\n');
}

// Construire la KEEP list
const KEEP = new Set<string>();
const DELETE = new Set<string>();

// 1. Fichiers utilisés selon Knip (analyse statique)
const usedFilesFromKnip = knip?.files || [];
for (const f of usedFilesFromKnip) {
  KEEP.add(f);
}

// 2. Fichiers exécutés (couverture c8)
const executedFiles = Object.keys(cov).filter(f => f.includes('/src/') || f.includes('\\src\\'));
for (const f of executedFiles) {
  KEEP.add(f);
}

// 3. Modules chargés dynamiquement
for (const f of loaded) {
  KEEP.add(f);
}

// 4. Hard-keep: modules cœur du flow (présents si existants)
const coreModules = [
  'src/index.ts',
  'src/marketMaker.ts',
  'src/clients/polySDK.ts',
  'src/clients/gamma.ts',
  'src/ws/marketFeed.ts',
  'src/ws/userFeed.ts',
  'src/data/discovery.ts',
  'src/data/book.ts',
  'src/risk/solvency.ts',
  'src/risk/sizing.ts',
  'src/lib/amounts.ts',
  'src/lib/round.ts',
  'src/lib/erc1155.ts',
  'src/inventory.ts',
  'src/allowanceManager.ts',
  'src/metrics/pnl.ts',
  'src/closeOrders.ts',
  'src/config.ts',
  'src/utils/approve.ts'
];

for (const f of coreModules) {
  if (fs.existsSync(f)) {
    KEEP.add(path.resolve(f));
  }
}

// 5. Construire DELETE à partir de tous les fichiers src/ non gardés
function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...getAllTsFiles(fullPath));
    } else if (item.name.endsWith('.ts') && !item.name.endsWith('.spec.ts')) {
      files.push(path.resolve(fullPath));
    }
  }
  
  return files;
}

const allSrcFiles = getAllTsFiles('src');
for (const f of allSrcFiles) {
  if (!KEEP.has(f)) {
    DELETE.add(f);
  }
}

// Normaliser les chemins pour l'affichage
const normalizeForDisplay = (files: Set<string>) => {
  return Array.from(files)
    .map(f => path.relative(process.cwd(), f).replace(/\\/g, '/'))
    .sort();
};

const keepList = normalizeForDisplay(KEEP);
const deleteList = normalizeForDisplay(DELETE);

// Écrire les listes
fs.mkdirSync('.audit', { recursive: true });
fs.writeFileSync('.audit/KEEPFILES.json', JSON.stringify(keepList, null, 2));
fs.writeFileSync('.audit/DELETECANDIDATES.json', JSON.stringify(deleteList, null, 2));

// Rapport
console.log('\n📊 AUDIT SUMMARY:');
console.log(`   ✅ KEEP: ${keepList.length} files`);
console.log(`   ❌ DELETE candidates: ${deleteList.length} files`);
console.log('\n📁 Files written:');
console.log('   - .audit/KEEPFILES.json');
console.log('   - .audit/DELETECANDIDATES.json');

if (deleteList.length > 0) {
  console.log('\n⚠️  DELETE CANDIDATES:');
  for (const f of deleteList) {
    console.log(`   - ${f}`);
  }
}

