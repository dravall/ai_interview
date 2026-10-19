import { config } from "@repo/eslint-config/base";

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    // Unwired, unmaintained experiment (see README) — not part of the running app.
    ignores: ["experiments/**"],
  },
];
