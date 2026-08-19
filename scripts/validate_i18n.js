#!/usr/bin/env node
/* @module validate_i18n — valida claves i18n usadas en js/ contra el diccionario */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const STATIC_JS = path.join(ROOT, 'app', 'static', 'js');
const SCAN = [...new Set([
  ...walk(path.join(STATIC_JS, 'modules')),
  ...walk(STATIC_JS),
])].filter((f) => f.endsWith('.js') && !f.includes('vendor'));

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const source = fs.readFileSync(path.join(STATIC_JS, 'i18n.js'), 'utf8');
const esMatch = source.match(/const es = (\{[\s\S]*?\n\});\n\nconst dict/);
if (!esMatch) {
  console.error('ERROR: no se pudo localizar `const es = {...}` en i18n.js');
  process.exit(2);
}
let es;
try {
  es = new Function(`return (${esMatch[1]})`)();
} catch (err) {
  console.error(`ERROR: dict inválido: ${err.message}`);
  process.exit(2);
}

function getPath(obj, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function leafKeys(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object') leafKeys(v, key, out);
    else out.push(key);
  }
  return out;
}

let errors = 0;
const warnings = [];
const used = new Set();

const CALL = /\bt\(\s*(?:'([^']+)'|`([^`]*)`)(?:\s*,\s*(\{[\s\S]*?\}))?\s*\)/g;

for (const file of SCAN) {
  const code = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  for (const m of code.matchAll(CALL)) {
    const literal = m[1];
    const template = m[2];
    const varsRaw = m[3];
    if (literal !== undefined) {
      used.add(literal);
      const value = getPath(es, literal);
      if (typeof value !== 'string') {
        errors++;
        console.error(`ERROR ${rel}: falta la clave '${literal}' (o no es texto)`);
      } else {
        checkPlaceholders(rel, literal, value, varsRaw, code, m.index);
      }
    } else if (template !== undefined) {
      const prefix = template.split('${')[0].replace(/\.$/, '');
      const value = getPath(es, prefix);
      if (value === undefined || typeof value !== 'object') {
        errors++;
        console.error(`ERROR ${rel}: prefijo dinámico '${prefix}' no existe o no es objeto`);
      } else {
        for (const leaf of leafKeys(value, prefix)) used.add(leaf);
      }
    }
  }
}

function checkPlaceholders(rel, key, value, varsRaw, code, index) {
  const placeholders = [...value.matchAll(/\{(\w+)\}/g)].map((p) => p[1]);
  if (!placeholders.length) return;
  if (!varsRaw) {
    warnings.push(
      `${rel}: '${key}' tiene {${placeholders.join(', ')}} y la llamada no pasa vars (línea ~${code.slice(0, index).split('\n').length})`
    );
    return;
  }
  const names = new Set([...varsRaw.replace(/[{}]/g, '').matchAll(/[A-Za-z_$][\w$]*/g)].map((p) => p[0]));
  for (const ph of placeholders) {
    if (!names.has(ph)) {
      warnings.push(`${rel}: '${key}' espera {${ph}} pero no se detecta en los vars de la llamada`);
    }
  }
}

for (const key of leafKeys(es)) {
  if (!used.has(key) && ![...used].some((u) => u.startsWith(`${key}.`))) {
    warnings.push(`clave definida sin uso: '${key}'`);
  }
}

for (const w of warnings) console.warn(`WARN ${w}`);
console.log(`\n${errors ? `FALLOS: ${errors}` : 'OK: todas las claves usadas existen y son texto'}`);
console.log(`avisos: ${warnings.length} · claves usadas: ${used.size}`);
process.exit(errors ? 1 : 0);