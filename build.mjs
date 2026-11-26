// Bündelt src/ → public/dist/ (nur nach Code-Änderungen nötig; zur Laufzeit braucht es node_modules nicht)
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  splitting: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: ['safari16', 'chrome110'],
  outdir: 'public/dist',
  chunkNames: 'chunks/[name]-[hash]',
  legalComments: 'none',
  logLevel: 'warning',
});

if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
