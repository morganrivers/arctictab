module.exports = {
  ignoreFiles: ["logdata", "logdata/**", "web-ext-artifacts", ".git", ".git/**"],
  run: {
    noInput: true,
    watchIgnored: ["logdata/**", "web-ext-artifacts/**", ".git/**"],
  },
};
