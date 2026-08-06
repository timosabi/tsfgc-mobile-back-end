import { createDefaultPreset } from "ts-jest";

const tsJestTransformCfg = createDefaultPreset({
  tsconfig: {
    target: "ES2020",
    module: "CommonJS",
    esModuleInterop: true,
    strict: true,
  },
}).transform;

/** @type {import("jest").Config} **/
export default {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/unit/**/*.spec.ts"],
  transform: {
    ...tsJestTransformCfg,
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
