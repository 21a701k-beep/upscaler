import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";

export default defineConfig([
  globalIgnores(["dist", "promo"]),
  {
    files: ["**/*.{js,jsx,mjs}"],
    extends: [js.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: ["*.config.js", "logo/*.mjs", "e2e/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/sw.js"],
    languageOptions: { globals: { ...globals.serviceworker, __BUILD__: "readonly" } },
  },
]);
