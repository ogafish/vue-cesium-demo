import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { pipelineTilesPlugin } from "./scripts/pipelineTiles/vitePipelineTilesPlugin.mjs";

export default defineConfig({
  plugins: [vue(), pipelineTilesPlugin()],
  server: {
    headers: {
      // 允许跨域隔离（Cesium 需要）
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    proxy: {
      "/api": {
        target: "http://localhost:48090",
        changeOrigin: true,
      },
      "/pipeline-tiles": {
        target: "http://localhost:48090",
        changeOrigin: true,
      },
    },
  }
});
