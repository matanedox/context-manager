import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const maxLines = ["error", { max: 250, skipBlankLines: false, skipComments: false }];

export default tseslint.config(
  { ignores: ["out/**", "test/**", "node_modules/**"] },
  {
    files: ["src/**/*.ts"],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "max-lines": maxLines,
    },
  },
  {
    files: ["webview/**/*.js"],
    ...eslint.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        acquireVsCodeApi: "readonly",
        window: "readonly",
        document: "readonly",
        CSS: "readonly",
      },
    },
    rules: {
      ...eslint.configs.recommended.rules,
      "max-lines": maxLines,
    },
  }
);
