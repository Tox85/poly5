// tools/deep-analysis.ts
// Analyse approfondie ligne par ligne de chaque fichier

import fs from 'fs';
import path from 'path';

interface FileAnalysis {
  file: string;
  totalLines: number;
  imports: string[];
  exports: string[];
  privateMethods: string[];
  publicMethods: string[];
  variables: string[];
  issues: string[];
}

const CORE_FILES = [
  'src/index.ts',
  'src/marketMaker.ts',
  'src/config.ts',
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
  'src/closeOrders.ts',
  'src/metrics/pnl.ts'
];

function analyzeFile(filePath: string): FileAnalysis {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  const analysis: FileAnalysis = {
    file: filePath,
    totalLines: lines.length,
    imports: [],
    exports: [],
    privateMethods: [],
    publicMethods: [],
    variables: [],
    issues: []
  };
  
  // Analyser les imports
  const importRegex = /^import\s+.*from\s+['"](.+)['"]/;
  const exportRegex = /^export\s+(const|function|class|type|interface)\s+(\w+)/;
  const privateMethodRegex = /^\s+private\s+(async\s+)?(\w+)\s*\(/;
  const publicMethodRegex = /^\s+public\s+(async\s+)?(\w+)\s*\(/;
  const constRegex = /^(export\s+)?const\s+(\w+)/;
  
  for (const line of lines) {
    // Imports
    const importMatch = line.match(importRegex);
    if (importMatch) {
      analysis.imports.push(importMatch[1]);
    }
    
    // Exports
    const exportMatch = line.match(exportRegex);
    if (exportMatch) {
      analysis.exports.push(exportMatch[2]);
    }
    
    // Private methods
    const privateMatch = line.match(privateMethodRegex);
    if (privateMatch) {
      analysis.privateMethods.push(privateMatch[2]);
    }
    
    // Public methods
    const publicMatch = line.match(publicMethodRegex);
    if (publicMatch) {
      analysis.publicMethods.push(publicMatch[2]);
    }
  }
  
  // Détection de problèmes potentiels
  if (analysis.imports.length > 30) {
    analysis.issues.push(`Too many imports: ${analysis.imports.length} (consider splitting file)`);
  }
  
  if (analysis.totalLines > 500) {
    analysis.issues.push(`Large file: ${analysis.totalLines} lines (consider splitting)`);
  }
  
  if (analysis.privateMethods.length > 20) {
    analysis.issues.push(`Many private methods: ${analysis.privateMethods.length} (review complexity)`);
  }
  
  return analysis;
}

// Analyser tous les fichiers core
console.log('🔬 Starting deep analysis of core files...\n');

const analyses: FileAnalysis[] = [];

for (const file of CORE_FILES) {
  if (!fs.existsSync(file)) {
    console.log(`⚠️  Skipping ${file} (not found)`);
    continue;
  }
  
  console.log(`📄 Analyzing ${file}...`);
  const analysis = analyzeFile(file);
  analyses.push(analysis);
  
  console.log(`   Lines: ${analysis.totalLines}`);
  console.log(`   Imports: ${analysis.imports.length}`);
  console.log(`   Exports: ${analysis.exports.length}`);
  console.log(`   Private methods: ${analysis.privateMethods.length}`);
  console.log(`   Public methods: ${analysis.publicMethods.length}`);
  
  if (analysis.issues.length > 0) {
    console.log(`   ⚠️  Issues:`);
    for (const issue of analysis.issues) {
      console.log(`      - ${issue}`);
    }
  }
  
  console.log('');
}

// Sauvegarder le rapport
fs.mkdirSync('.audit', { recursive: true });
fs.writeFileSync('.audit/deep-analysis.json', JSON.stringify(analyses, null, 2));

console.log('\n📊 SUMMARY:');
console.log(`   Files analyzed: ${analyses.length}`);
console.log(`   Total lines: ${analyses.reduce((sum, a) => sum + a.totalLines, 0)}`);
console.log(`   Total exports: ${analyses.reduce((sum, a) => sum + a.exports.length, 0)}`);
console.log(`   Files with issues: ${analyses.filter(a => a.issues.length > 0).length}`);

console.log('\n📁 Report saved: .audit/deep-analysis.json');

