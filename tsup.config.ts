import { defineConfig, type Options } from "tsup";

export default defineConfig((options: Options) => ({
  entry: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.test.{ts,tsx}",
    "!src/**/*.stories.{ts,tsx}",
    "!src/**/*.d.{ts,tsx}",
  ],
  clean: true,
  splitting: false,
  format: ["esm"],
  ...options,
}));
