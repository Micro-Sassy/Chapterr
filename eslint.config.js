import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", ".wrangler", "worker/worker-configuration.d.ts", "playwright-report", "test-results", "dev-dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // These React Compiler rules misreport React Hook Form's handleSubmit; the app does not use the compiler.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/incompatible-library": "off",
    },
  },
  {
    // Tests inspect loosely-typed JSON payloads.
    files: ["tests/**/*.ts", "e2e/**/*.ts", "**/*.test.{ts,tsx}"],
    rules: { "@typescript-eslint/no-explicit-any": "off", "react-hooks/rules-of-hooks": "off" },
  },
);
