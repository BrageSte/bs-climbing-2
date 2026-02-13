import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

/**
 * Converts render-blocking <link rel="stylesheet"> tags into non-blocking
 * preload patterns so the inline HTML skeleton can paint immediately.
 *
 * Before: <link rel="stylesheet" crossorigin href="/assets/index-xxx.css">
 * After:  <link rel="preload" href="..." as="style" crossorigin onload="this.onload=null;this.rel='stylesheet'">
 *         <noscript><link rel="stylesheet" href="..." crossorigin></noscript>
 */
function asyncCssPlugin(): Plugin {
  return {
    name: "vite-plugin-async-css",
    enforce: "post",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        /<link rel="stylesheet"([^>]*?)>/g,
        (_match, attrs: string) => {
          const hrefMatch = attrs.match(/href="([^"]+)"/);
          if (!hrefMatch) return _match;
          const href = hrefMatch[1];
          const otherAttrs = attrs.replace(/\s*href="[^"]+"\s*/, " ").trim();
          const extras = otherAttrs ? ` ${otherAttrs}` : "";
          return (
            `<link rel="preload" href="${href}" as="style"${extras} onload="this.onload=null;this.rel='stylesheet'">\n` +
            `    <noscript><link rel="stylesheet" href="${href}"${extras}></noscript>`
          );
        },
      );
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), asyncCssPlugin(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("vite/preload-helper") ||
            id.includes("modulepreload-polyfill")
          ) {
            return "vendor-runtime";
          }

          if (!id.includes("node_modules")) {
            return;
          }

          if (
            id.includes("/three/") ||
            id.includes("/@react-three/") ||
            id.includes("/three-stdlib/") ||
            id.includes("/three-mesh-bvh/")
          ) {
            return "vendor-three";
          }

          if (id.includes("/@supabase/")) {
            return "vendor-supabase";
          }

          if (id.includes("/@radix-ui/")) {
            return "vendor-radix";
          }

          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/react-router/") ||
            id.includes("/react-router-dom/") ||
            id.includes("/scheduler/")
          ) {
            return "vendor-react";
          }

          if (
            id.includes("/framer-motion/") ||
            id.includes("/motion-dom/") ||
            id.includes("/motion-utils/")
          ) {
            return "vendor-motion";
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
    exclude: ['three', '@react-three/fiber', '@react-three/drei'],
  },
}));
