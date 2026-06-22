module.exports = {
  ignoreFiles: ["logdata", "logdata/**", "web-ext-artifacts", ".git", ".git/**"],
  run: {
    watchIgnored: ["logdata/**", "web-ext-artifacts/**", ".git/**"],
  },
};
