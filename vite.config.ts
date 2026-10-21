import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { nitro } from "nitro/vite";
import vinext from "vinext";
import { defineConfig } from "vite";

const require = createRequire(import.meta.url);

/**
 * 解析只通过 package.json `exports` 里的 `style` 条件暴露样式入口的包。
 *
 * 这类包（如 tw-animate-css）没有 `./package.json` 导出，`require.resolve`
 * 无法定位；因此沿模块解析路径找到包目录，再读 exports["."] 得到真实文件。
 */
function resolveStyleEntry(packageName: string): string {
  const packageDir = (require.resolve.paths(packageName) ?? [])
    .map((base) => path.join(base, packageName))
    .find((candidate) => fs.existsSync(path.join(candidate, "package.json")));

  if (!packageDir) throw new Error(`Cannot locate package: ${packageName}`);

  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageDir, "package.json"), "utf8"),
  ) as { exports: Record<string, string | { style?: string }> };
  const entry = manifest.exports["."];
  const target = typeof entry === "string" ? entry : entry.style;

  if (!target) {
    throw new Error(`Package ${packageName} has no "style" export for "."`);
  }
  return path.resolve(packageDir, target);
}

/**
 * Vite 内联 `@import` 时用的是独立的 CSS 解析器，无法解析仅带 `style` 条件的
 * 裸包名；解析失败后它会退回裸 id，并触发 `readFile(join(root, id))`，
 * 报 `ENOENT: ... /tailwindcss`。这里把裸包名预解析成绝对路径，绕开该路径。
 */
const stylesheetAliases = [
  { find: /^tailwindcss$/, replacement: require.resolve("tailwindcss/index.css") },
  { find: /^tw-animate-css$/, replacement: resolveStyleEntry("tw-animate-css") },
];

export default defineConfig({
  plugins: [vinext(), nitro({
    preset: "vercel",
    wasm: false,
    vercel: {
      functionRules: {
        "/api/internal/checks/pump": {maxDuration: 55},
        "/api/internal/checks/run": {maxDuration: 55},
        "/api/cron/check": {maxDuration: 55},
      },
    },
  })],
  resolve: { alias: stylesheetAliases },
});
