// scripts/smoke.js
// Script de test smoke : exécute le bot pendant 25s puis arrête proprement

const { spawn } = require('node:child_process');

console.log('🔥 Starting smoke test (25s run)...');

const child = spawn('node', ['dist/index.js'], { 
  stdio: 'inherit', 
  env: { ...process.env, NODE_ENV: 'smoke' } 
});

// Timeout de 25s
setTimeout(() => {
  console.log('\n⏱️  Smoke test timeout reached - sending SIGINT...');
  child.kill('SIGINT');
}, 25000);

child.on('exit', (code) => {
  console.log(`✅ Smoke test completed with exit code: ${code ?? 0}`);
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('❌ Smoke test error:', err);
  process.exit(1);
});

