// tools/analyze-unused-exports.ts
// Analyse détaillée des exports inutilisés

import fs from 'fs';
import { execSync } from 'child_process';

const UNUSED_EXPORTS = [
  { file: 'src/config.ts', name: 'CHAIN_ID', line: 5 },
  { file: 'src/config.ts', name: 'SPREAD_MULTIPLIER_LOW', line: 37 },
  { file: 'src/config.ts', name: 'SPREAD_MULTIPLIER_HIGH', line: 38 },
  { file: 'src/risk/solvency.ts', name: 'hasFundsAndAllowance', line: 28 },
  { file: 'src/lib/amounts.ts', name: 'toMicro', line: 11 },
  { file: 'src/risk/sizing.ts', name: 'calculateMaxSafeSize', line: 70 },
  { file: 'src/risk/sizing.ts', name: 'calculateMaxSafeSizeWithInventory', line: 87 },
  { file: 'src/clients/gamma.ts', name: 'fetchOpenTradableMarkets', line: 27 },
  { file: 'src/data/book.ts', name: 'Top', line: 7, type: 'type' },
];

console.log('🔍 Analyzing unused exports...\n');

const results: any[] = [];

for (const exp of UNUSED_EXPORTS) {
  console.log(`\n📌 Checking: ${exp.name} in ${exp.file}`);
  
  try {
    // Rechercher dans tout le codebase
    const grepCmd = `grep -r "${exp.name}" src/ scripts/ tools/ --include="*.ts" --include="*.tsx" | wc -l`;
    const count = parseInt(execSync(grepCmd, { encoding: 'utf-8', shell: 'bash' }).trim());
    
    // Rechercher les imports spécifiques
    const importCmd = `grep -r "import.*${exp.name}" src/ scripts/ --include="*.ts" | wc -l`;
    const importCount = parseInt(execSync(importCmd, { encoding: 'utf-8', shell: 'bash' }).trim());
    
    const status = count <= 1 ? '❌ UNUSED' : (importCount > 0 ? '✅ USED' : '⚠️ CHECK');
    
    console.log(`   Occurrences: ${count}`);
    console.log(`   Imports: ${importCount}`);
    console.log(`   Status: ${status}`);
    
    results.push({
      ...exp,
      occurrences: count,
      imports: importCount,
      status: count <= 1 ? 'UNUSED' : (importCount > 0 ? 'USED' : 'CHECK')
    });
  } catch (error) {
    console.log(`   ⚠️ Error analyzing: ${error}`);
    results.push({
      ...exp,
      status: 'ERROR',
      error: String(error)
    });
  }
}

// Sauvegarder le rapport
fs.mkdirSync('.audit', { recursive: true });
fs.writeFileSync('.audit/unused-exports-analysis.json', JSON.stringify(results, null, 2));

console.log('\n\n📊 SUMMARY:');
console.log(`   Total analyzed: ${UNUSED_EXPORTS.length}`);
console.log(`   Confirmed unused: ${results.filter(r => r.status === 'UNUSED').length}`);
console.log(`   Still in use: ${results.filter(r => r.status === 'USED').length}`);
console.log(`   Needs check: ${results.filter(r => r.status === 'CHECK').length}`);

console.log('\n📁 Report saved: .audit/unused-exports-analysis.json');

