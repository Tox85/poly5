// scripts/smoke.js
// Smoke test: lance le bot pendant 25 secondes puis l'arrête proprement

const { spawn } = require('node:child_process');
const path = require('path');

console.log('🧪 Starting smoke test (25s run)...');

const child = spawn('node', ['dist/index.js'], { 
  stdio: 'inherit', 
  env: { ...process.env, NODE_ENV: 'smoke' },
  cwd: path.join(__dirname, '..')
});

// Arrêter après 25 secondes
setTimeout(() => {
  console.log('\n⏱️ Smoke test timeout reached - sending SIGINT...');
  child.kill('SIGINT');
}, 25000);

child.on('exit', (code) => {
  console.log(`\n✅ Smoke test completed with exit code: ${code ?? 0}`);
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('❌ Smoke test failed:', err);
  process.exit(1);
});

