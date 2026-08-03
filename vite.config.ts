import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { prerenderMath } from "./src/vite/prerenderMath";

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [preact(), prerenderMath()],
  optimizeDeps: {
    include: ["three", "cannon-es", "uplot", "katex", "codemirror", "@codemirror/lang-javascript"],
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: root("./index.html"),
        imu: root("./demos/imu/index.html"),
      },
    },
  },
});
