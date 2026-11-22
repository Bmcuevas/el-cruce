// Cifra el PDF de la lista con el código del viaje (el repo es público).
// Uso: node tools/pack-doc.mjs <archivo.pdf> <codigo-del-viaje> <páginas> "<fecha legible>"
import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
const [pdfPath, code, pages, updated] = process.argv.slice(2);
if (!pdfPath || !code) { console.error('uso: pack-doc.mjs <pdf> <codigo> [paginas] [fecha]'); process.exit(1); }
const pdf = readFileSync(pdfPath);
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pdf));
const out = new Uint8Array(28 + ct.length); out.set(salt, 0); out.set(iv, 16); out.set(ct, 28);
writeFileSync('docs/lista.enc', out);
writeFileSync('docs/lista.json', JSON.stringify({ updated: updated || new Date().toISOString().slice(0, 10), pages: Number(pages) || null }) + '\n');
console.log('docs/lista.enc', out.length, 'bytes');
