import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { OBF_OPTS } from '../asset-options.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'build/assets');
fs.mkdirSync(output, { recursive: true });
const files = fs.readdirSync(path.join(root, 'public/src/js')).filter(f => f.endsWith('.js')).sort().map(f => 'src/js/' + f);
files.push('app/main.mjs', 'app/runtime/engine.mjs');
const manifest = {};
for (const file of files) {
    const source = fs.readFileSync(path.join(root, 'public', file), 'utf8');
    // Fail the build rather than silently serving untransformed code.
    const code = JavaScriptObfuscator.obfuscate(source, { ...OBF_OPTS, seed: 1 }).getObfuscatedCode();
    const hash = createHash('sha256').update(code).digest('hex') + '.js';
    fs.writeFileSync(path.join(output, hash), code);
    manifest[file] = hash;
}
fs.writeFileSync(path.join(output, 'manifest.json.tmp'), JSON.stringify(manifest, null, 2) + '\n');
fs.renameSync(path.join(output, 'manifest.json.tmp'), path.join(output, 'manifest.json'));
console.log('Built ' + files.length + ' assets');
