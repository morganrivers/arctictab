module.exports = {
  ignoreFiles: [
    "logdata",
    "logdata/**",
    "web-ext-artifacts",
    "node_modules",
    "node_modules/**",
    "tests",
    "tests/**",
    "*.md",
    "setup.sh",
    "scripts",
    "scripts/**",
    "viewer.py",
    "package.json",
    "package-lock.json",
    "web-ext-config.cjs",
    ".git",
    ".git/**",
  ],
  run: {
    watchIgnored: ["logdata/**", "web-ext-artifacts/**", ".git/**"],
  },
};
