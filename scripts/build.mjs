#!/usr/bin/env node
// Builds the single-file app: inlines src/core.js into src/app.html and wraps it in a full HTML document.
// Output: index.html (open it directly in a browser, or serve it with GitHub Pages).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = readFileSync(join(root, 'src/core.js'), 'utf8');
const app = readFileSync(join(root, 'src/app.html'), 'utf8');

if (!app.includes('/*CORE*/')) throw new Error('src/app.html is missing the /*CORE*/ placeholder');
const page = app.replace('/*CORE*/', () => core);

// split the template into <head> material (title, meta, fonts, styles) and <body> material
const styleEnd = page.indexOf('</style>') + '</style>'.length;
const head = page.slice(0, styleEnd);
const body = page.slice(styleEnd);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="ParaVent: parametric perforation and vent-pattern generator with solid STEP export.">
${head}
</head>
<body>
${body}
</body>
</html>
`;
writeFileSync(join(root, 'index.html'), html);
console.log(`Built index.html (${(html.length / 1024).toFixed(0)} KB)`);
