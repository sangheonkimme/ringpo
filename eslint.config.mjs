import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "dist/**",
    "drizzle/**",
    "deploy/**",
    "coverage/**",
    ".superpowers/**",
    // Figma 플러그인은 Figma 안에서만 도는 별도 런타임(figma 전역)이라 앱 lint 대상이 아니다
    "tools/figma-ringpo-ds/**",
  ]),
]);

export default eslintConfig;
