import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals.js";
import nextTypeScript from "eslint-config-next/typescript.js";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  globalIgnores([".next/**", "coverage/**", "next-env.d.ts"]),
]);
