// Guarda da identidade visual: símbolo (ícone School do lucide num quadrado teal), PNGs e metadados.
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..');
const bytes = (p: string) => readFileSync(resolve(root, p));
const text = (p: string) => readFileSync(resolve(root, p), 'utf-8');
const pngSize = (p: string) => {
  const b = bytes(p);
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // assinatura PNG
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

describe('símbolo da marca', () => {
  const svg = text('public/favicon.svg');

  it('favicon.svg: quadrado 64×64, rx 16, teal #186E64, sem o "$"', () => {
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toMatch(/<rect[^>]*rx="16"[^>]*fill="#186E64"/);
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('$');
  });

  it('usa os paths exatos do ícone School do lucide-react instalado (viewBox 24, traço 2, branco, 32 px no centro)', () => {
    const lucide = text('node_modules/lucide-react/dist/esm/icons/school.js');
    const paths = [...lucide.matchAll(/\bd: "([^"]+)"/g)].map((m) => m[1]);
    expect(paths.length).toBe(5);
    for (const d of paths) expect(svg).toContain(`d="${d}"`);
    expect(svg).toContain('<circle cx="12" cy="9" r="2"/>');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('stroke="#ffffff"');
    expect(svg).toMatch(/translate\(16 16\) scale\(1\.3333/); // 24 → 32 px, centralizado nos 64
  });
});

describe('arquivos gerados', () => {
  it('logo do e-mail: PNG 64×64 em public/email/logo-64.png (vira /email/logo-64.png no build)', () => {
    expect(pngSize('public/email/logo-64.png')).toEqual([64, 64]);
    expect(statSync(resolve(root, 'public/email/logo-64.png')).size).toBeLessThan(10_000);
  });

  it('apple-touch-icon 180×180 e og-image 1200×630', () => {
    expect(pngSize('public/apple-touch-icon.png')).toEqual([180, 180]);
    expect(pngSize('public/og-image.png')).toEqual([1200, 630]);
  });

  it('favicon.ico com 3 imagens (16, 32 e 48)', () => {
    const b = bytes('public/favicon.ico');
    expect([b.readUInt16LE(0), b.readUInt16LE(2), b.readUInt16LE(4)]).toEqual([0, 1, 3]);
    expect([0, 1, 2].map((i) => b[6 + 16 * i])).toEqual([16, 32, 48]);
  });

  it('og-image.svg é a mesma arte (símbolo novo, sem "$")', () => {
    const svg = text('public/og-image.svg');
    expect(svg).toContain('Class Cash');
    expect(svg).toContain('Gestão financeira escolar simplificada');
    expect(svg).toContain('<circle cx="12" cy="9" r="2"/>');
    expect(svg).not.toContain('>$<');
  });
});

describe('index.html e login', () => {
  const html = text('index.html');

  it('aponta og:image, twitter:image e og:url para o domínio próprio', () => {
    expect(html).toContain('<meta property="og:image" content="https://classcash.com.br/og-image.png" />');
    expect(html).toContain('<meta name="twitter:image" content="https://classcash.com.br/og-image.png" />');
    expect(html).toContain('<meta property="og:url" content="https://classcash.com.br/" />');
    expect(html).not.toContain('vercel.app');
  });

  it('referencia favicon.svg, favicon.ico e apple-touch-icon 180×180', () => {
    expect(html).toContain('href="/favicon.svg"');
    expect(html).toContain('href="/favicon.ico"');
    expect(html).toMatch(/rel="apple-touch-icon"[^>]*sizes="180x180"[^>]*href="\/apple-touch-icon\.png"/);
  });

  it('a tela de login usa School no lugar de DollarSign como marca, e o contêiner igual ao da sidebar', () => {
    const auth = text('src/pages/Auth.tsx');
    expect(auth).not.toContain('DollarSign');
    const sidebarBox = 'flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground';
    expect(text('src/components/layout/AppSidebar.tsx')).toContain(sidebarBox);
    expect(auth).toContain(sidebarBox);
    expect(auth).toContain('<School className="h-4 w-4" />');
  });
});
