# cursor1

## Cursor Cloud specific instructions

State of the repository (as of environment setup): this is an empty starter repo. The only tracked file is `README.md`. There is:

- No application code, entry point, or runnable service.
- No dependency manifest (`package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, etc.).
- No build/lint/test tooling, scripts, `Makefile`, `Dockerfile`, or CI config.

Because there is nothing to install, build, run, or test yet, there is no dev server or "hello world" flow to exercise. The startup update script is intentionally a guarded no-op that only installs dependencies once a manifest is added.

Baseline runtimes available on the VM: Node.js 22, npm 10, Python 3.12, Go 1.22, Rust 1.83. Docker is not installed.

When real code is added, update the startup update script (via the environment setup) to install its dependencies, and replace this section with concrete lint/test/build/run commands for the new service(s).
