// build.mjs - esbuildで各Lambdaを単一ファイルにバンドル
import * as esbuild from 'esbuild';
import { rmSync, mkdirSync } from 'fs';

const lambdas = ['auth', 'diary', 'stripe'];
const external = ['@aws-sdk/*']; // Lambda実行環境に含まれるので除外

rmSync('dist', { recursive: true, force: true });

for (const name of lambdas) {
  mkdirSync(`dist/${name}`, { recursive: true });
  await esbuild.build({
    entryPoints: [`lambda/${name}/index.ts`],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: `dist/${name}/index.js`,
    external,
    sourcemap: false,
    minify: false,
  });
  console.log(`✓ ${name} ビルド完了`);
}
console.log('ビルド完了');
