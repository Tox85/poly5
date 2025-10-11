// tools/verify-no-quarantine-deps.ts
// Vérifie qu'AUCUN fichier actif n'importe des fichiers en quarantaine

import fs from 'fs';
import path from 'path';

const QUARANTINE_FILES = [
  'customClob',
  'signer',
  'inventoryPersistence',
  'persistence',
  'logLimiter'
];

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  
  if (!fs.existsSync(dir)) return files;
  
  const items = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    
    if (item.isDirectory()) {
      files.push(...getAllTsFiles(fullPath));
    } else if (item.name.endsWith('.ts') && !item.name.endsWith('.bak')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

function checkFile(filePath: string): { file: string; imports: string[] } {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  const suspiciousImports: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Chercher les imports
    if (line.includes('import') && line.includes('from')) {
      for (const quarantineFile of QUARANTINE_FILES) {
        if (line.includes(quarantineFile)) {
          suspiciousImports.push(`Line ${i + 1}: ${line.trim()}`);
        }
      }
    }
  }
  
  return {
    file: path.relative(process.cwd(), filePath),
    imports: suspiciousImports
  };
}

console.log('🔍 Vérification des imports vers les fichiers en quarantaine...\n');

const srcFiles = getAllTsFiles('src');
const scriptFiles = getAllTsFiles('scripts');

const allFiles = [...srcFiles, ...scriptFiles];

console.log(`📁 Fichiers à vérifier: ${allFiles.length}\n`);

let problemsFound = 0;
const problems: any[] = [];

for (const file of allFiles) {
  const result = checkFile(file);
  
  if (result.imports.length > 0) {
    problemsFound++;
    problems.push(result);
    
    console.log(`❌ PROBLÈME: ${result.file}`);
    for (const imp of result.imports) {
      console.log(`   ${imp}`);
    }
    console.log('');
  }
}

if (problemsFound === 0) {
  console.log('✅ AUCUN import vers des fichiers en quarantaine détecté !');
  console.log('✅ Le flow est TOTALEMENT INDÉPENDANT de la quarantaine.');
  console.log('\n🎉 Validation réussie : npm start ne dépend QUE de src/ actif');
} else {
  console.log(`\n❌ ${problemsFound} fichier(s) avec imports suspects trouvés.`);
  console.log('⚠️  Ces fichiers doivent être corrigés ou archivés.\n');
}

// Sauvegarder le rapport
fs.mkdirSync('.audit', { recursive: true });
fs.writeFileSync('.audit/quarantine-verification.json', JSON.stringify({
  verified: allFiles.length,
  problems: problems.length,
  details: problems
}, null, 2));

console.log('\n📁 Rapport sauvegardé: .audit/quarantine-verification.json');

process.exit(problemsFound > 0 ? 1 : 0);

