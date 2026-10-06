import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Unity 가 만들어낸 빌드 산출물(천호 님의 3D 시뮬레이션)입니다. 우리가 쓴
    // 코드가 아니고 손대지도 않으므로 검사에서 뺍니다.
    "public/safety-gate-3d/**",
  ]),
]);

export default eslintConfig;
