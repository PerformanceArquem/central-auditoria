import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = process.argv[2]
  ? resolve(process.argv[2])
  : await mkdtemp(resolve(root, 'pages-check-'));
const files = [
  'index.html', 'confirmar-leitura.html', 'confirmar-leitura.css', 'confirmar-leitura.js',
  'ai-reports.js', 'email-delivery-control.js', 'email-report-catalog.js',
  'intelligence-triage.js', 'production-flow.js',
  'ui/api-client.js', 'ui/dashboard.css', 'ui/theme.css', 'ui/theme.js',
  'ui/ticket-inspection.mjs', 'ui/ura-periods.js', 'ui/ura-recording.js',
  'ui/workspace.css', 'ui/workspace.js',
  'lib/ticket-inspection.mjs', 'lib/ticket-delay-risk.mjs'
];
const allowed = new Set(files);
const secretPattern = /sb_secret_[\w-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[\w-]{15,}\.[\w-]{15,}\.[\w-]{15,}|AIza[\w-]{35}|(?:ghp_|github_pat_)[\w-]{20,}/;

try {
  await mkdir(destination, { recursive: true });
  if ((await readdir(destination)).length) throw Error('A pasta de publicação deve estar vazia.');
  for (const file of files) {
    const content = await readFile(resolve(root, file), 'utf8');
    if (secretPattern.test(content)) throw Error('Possível credencial em ' + file);
    const references = file.endsWith('.html')
      ? [...content.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/gi)]
      : [...content.matchAll(/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g)];
    for (const [, reference] of references) {
      const asset = new URL(reference, 'https://example.invalid/central-auditoria/' + file);
      if (asset.origin !== 'https://example.invalid') continue;
      const base = '/central-auditoria/';
      if (!asset.pathname.startsWith(base) || !allowed.has(asset.pathname.slice(base.length))) {
        throw Error(file + ' referencia arquivo ausente ou fora da base: ' + reference);
      }
    }
  }
  if (process.argv[2]) {
    for (const file of files) {
      const target = resolve(destination, file);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(resolve(root, file), target);
    }
  }
  console.log(files.length + ' arquivos estáticos verificados para /central-auditoria/.');
} finally {
  if (!process.argv[2]) await rm(destination, { recursive: true });
}
