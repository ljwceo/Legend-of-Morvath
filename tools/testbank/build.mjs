// Builds the morning test bench into one self-contained HTML file: tools/testbank/out/testbank.html.
// Usage: npm run testbank
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';

const root = import.meta.dirname;
const dist = join(root, 'dist');
await build({
  root,
  base: './',
  configFile: false,
  logLevel: 'warn',
  define: { __BUILD_ID__: '"testbank"' },
  build: {
    outDir: dist,
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
  },
});

const assets = join(dist, 'assets');
const files = readdirSync(assets);
const read = (ext) =>
  readFileSync(
    join(
      assets,
      files.find((f) => f.endsWith(ext)),
    ),
    'utf8',
  );
const source = readFileSync(join(root, 'index.html'), 'utf8');
const title = /<title>(.*?)<\/title>/s.exec(source)?.[1] ?? 'Morvath Testbank';
const body = /<body>(.*?)<script/s.exec(source)?.[1] ?? '';
const fonts =
  'https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC' +
  '&family=Alegreya+Sans:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap';
const html = `<title>${title}</title>
<link rel="stylesheet" href="${fonts}">
<style>${read('.css')}</style>
${body}
<script type="module">${read('.js').replaceAll('</script', '<\\/script')}</script>
`;
mkdirSync(join(root, 'out'), { recursive: true });
writeFileSync(join(root, 'out', 'testbank.html'), html);
rmSync(dist, { recursive: true, force: true });
console.log(`testbank: tools/testbank/out/testbank.html (${Math.round(html.length / 1024)} kB)`);
