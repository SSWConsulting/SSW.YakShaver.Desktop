/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    roots: ["<rootDir>/src"],
    testMatch: ["**/*.test.ts", "**/*.spec.ts"],
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
    transform: {
        "^.+\\.tsx?$": [
            "ts-jest",
            {
                useESM: false,
                tsconfig: {
                    module: "commonjs",
                    moduleResolution: "node",
                    esModuleInterop: true,
                },
            },
        ],
    },
    moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
    },
    collectCoverageFrom: [
        "src/**/*.ts",
        "!src/**/*.d.ts",
        "!src/**/*.test.ts",
        "!src/**/*.spec.ts",
    ],
    coverageDirectory: "coverage",
    verbose: true,
};
