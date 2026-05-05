const fs = require('fs');
const path = require('path');

const root = __dirname;
const outDir = path.join(root, 'dist');
const skip = new Set(['dist', 'build.js', 'package.json']);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const entry of fs.readdirSync(root)) {
  if (skip.has(entry)) continue;

  const source = path.join(root, entry);
  const target = path.join(outDir, entry);
  const stat = fs.statSync(source);

  if (stat.isFile()) {
    fs.copyFileSync(source, target);
  }
}

console.log(`Static frontend copied to ${outDir}`);
