const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const output = path.join(root, 'dist');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(path.join(root, 'manage_MKT.html'), path.join(output, 'index.html'));
fs.cpSync(path.join(root, 'css'), path.join(output, 'css'), { recursive: true });
fs.cpSync(path.join(root, 'js'), path.join(output, 'js'), { recursive: true });
fs.cpSync(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });

console.log('Cloudflare static assets built in dist/');
