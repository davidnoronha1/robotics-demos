import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { mathSvgs } from "./scripts/math-svgs-plugin";
import { asyncStylesheets } from "./scripts/async-stylesheet-plugin";

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [preact(), mathSvgs(), asyncStylesheets()],
  optimizeDeps: {
    include: ["three", "uplot", "codemirror", "@codemirror/lang-javascript"],
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: root("./index.html"),
        imu: root("./demos/imu/index.html"),
        optical: root("./demos/opticalflow/index.html"),
      },
    },
  },
});
