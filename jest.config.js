const nextJest = require("next/jest");

const createJestConfig = nextJest({
  // Load next.config.js and .env files in the test environment.
  dir: "./",
});

/** @type {import('jest').Config} */
const config = {
  // API-route tests run in Node, not a browser DOM.
  testEnvironment: "node",
  // Handle ESM-only deps (e.g. @workos-inc/authkit-nextjs) that only expose an
  // `import` condition in their `exports` map. See jest.resolver.js.
  resolver: "<rootDir>/jest.resolver.js",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};

module.exports = createJestConfig(config);
