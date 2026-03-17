import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import security from "eslint-plugin-security";
import tseslint from "typescript-eslint";

const isSecurityLint = process.env.SECURITY_LINT === "1";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "supabase/.temp"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
        Deno: "readonly",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  ...(isSecurityLint
    ? [
        {
          files: ["supabase/functions/**/*.{ts,js}", "scripts/**/*.{ts,js,mjs,cjs}"],
          plugins: {
            security,
          },
          rules: {
            ...security.configs.recommended.rules,
            "security/detect-object-injection": "off",
          },
        },
      ]
    : []),
);
