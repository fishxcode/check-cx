import { nitro } from "nitro/vite";
import vinext from "vinext";
import { defineConfig } from "vite";

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
});
