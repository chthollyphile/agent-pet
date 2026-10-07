// 打包 src/shared-entry.ts → lib/shared.mjs（QML 以 `import "lib/shared.mjs" as Shared` 导入）。
// 用法：node tools/build-shared.mjs [dsh-pet 插件目录]（默认 ../dsh-pet/dsh-pet）
import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dsh = resolve(process.argv[2] ?? resolve(root, '../dsh-pet/dsh-pet'));

await build({
  entryPoints: [resolve(root, 'src/shared-entry.ts')],
  outfile: resolve(root, 'lib/shared.mjs'),
  bundle: true,
  format: 'esm',
  // QV4 引擎对新语法支持不全：降到 ES2017，`?.` / `??` 由 esbuild 改写
  target: 'es2017',
  alias: { '@dsh/shared': resolve(dsh, 'src/shared') },
  banner: { js: '// 生成文件，勿手改：node tools/build-shared.mjs' },
  logLevel: 'info',
});
