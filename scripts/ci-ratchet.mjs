// Catraca de qualidade para o CI (S6, bloco 3, fase 1).
// O projeto tem dívida antiga em tipos e lint (ver ci-baseline.json). O CI não bloqueia pela dívida que já existe, mas FALHA se
// qualquer PR a aumentar. Quando alguém reduz a dívida, o PR deve baixar o número no ci-baseline.json (o script avisa).
// Uso: node scripts/ci-ratchet.mjs tsc | eslint
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const kind = process.argv[2];
const baseline = JSON.parse(readFileSync(new URL('../ci-baseline.json', import.meta.url), 'utf8'));
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(args) {
  const r = spawnSync(npx, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' });
  return { out: (r.stdout ?? '') + (r.stderr ?? ''), status: r.status };
}

let current;
if (kind === 'tsc') {
  const { out } = run(['tsc', '--noEmit', '-p', 'tsconfig.app.json']);
  current = (out.match(/error TS\d+/g) ?? []).length;
} else if (kind === 'eslint') {
  const { out } = run(['eslint', '.', '--format', 'json']);
  try {
    current = JSON.parse(out.slice(out.indexOf('['))).reduce((n, f) => n + f.errorCount, 0);
  } catch {
    console.error('Não foi possível ler a saída do eslint:\n' + out.slice(0, 2000));
    process.exit(2);
  }
} else {
  console.error('Uso: node scripts/ci-ratchet.mjs tsc | eslint');
  process.exit(2);
}

const allowed = baseline[kind];
console.log(`${kind}: ${current} erro(s); linha de base: ${allowed}`);
if (current > allowed) {
  console.error(`FALHOU: ${kind} piorou (${current} > ${allowed}). Corrija os erros novos; a dívida antiga não bloqueia, mas não pode crescer.`);
  process.exit(1);
}
if (current < allowed) {
  console.log(`Melhorou! Baixe "${kind}" para ${current} em ci-baseline.json neste PR para travar o ganho.`);
}
