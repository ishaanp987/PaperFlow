# Contributing

Download or clone the repository, install Node.js 24 or newer, and run `node src/server.ts`. No dependency install is required.

Before opening a pull request, run:

```sh
node --test test/*.test.ts
node scripts/check.mjs
```

Test the affected browser workflow. For UI changes, check desktop and a narrow mobile viewport. Keep provider calls mocked in tests; never use a contributor's real keys in CI. Add tests for new behavior or a reproduced bug when useful.

Keep credentials and student PDFs out of commits, screenshots, logs, and issue reports. Use synthetic notes such as `examples/functions.pdf`. Explain what changed and how you verified it in your pull request.

Follow the existing module boundaries. Keep source adapters, AI processing, persistence, publishing, and export independently replaceable. Avoid adding installation steps or heavy dependencies unless their benefit justifies the burden for users downloading the project.

For bugs, include the operating system, Node version, steps to reproduce, and expected/actual behavior. Do not include private notes or raw provider error bodies. For security vulnerabilities, follow SECURITY.md.
