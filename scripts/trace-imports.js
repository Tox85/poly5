// scripts/trace-imports.js
// Hook require() pour tracer tous les modules chargés depuis src/

const fs = require('fs');
const Module = require('module');
const path = require('path');

const loaded = new Set();
const origLoad = Module._load;

Module._load = function(request, parent, isMain) {
  const result = origLoad.apply(this, arguments);
  
  try {
    const resolved = Module._resolveFilename(request, parent);
    // Ne garder que les fichiers du projet (dans src/)
    if (resolved.includes(path.sep + 'src' + path.sep)) {
      loaded.add(path.resolve(resolved));
    }
  } catch (err) {
    // Ignorer les erreurs de résolution
  }
  
  return result;
};

// Sauvegarder les modules chargés à la sortie
process.on('exit', () => {
  fs.mkdirSync('.audit', { recursive: true });
  fs.writeFileSync(
    '.audit/loaded-modules.json', 
    JSON.stringify([...loaded].sort(), null, 2)
  );
  console.log(`\n📊 Traced ${loaded.size} modules from src/`);
});

// Lancer le bot
console.log('🔍 Tracing module imports...');
require('../dist/index.js');

