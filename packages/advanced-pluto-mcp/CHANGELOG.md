# [0.9.0](https://github.com/JuliaPluto/advanced-vscode-extension/compare/mcp-v0.8.0...mcp-v0.9.0) (2026-09-04)

### Bug Fixes

- **server:** report the Pluto port to the manager when it returns to the default ([ca8dd48](https://github.com/JuliaPluto/advanced-vscode-extension/commit/ca8dd488e7b2ef3ca76b3ffe3ac556a0cd1b0143))

### Features

- **notebook:** show Pluto's hidden cells with their code collapsed ([47b4c42](https://github.com/JuliaPluto/advanced-vscode-extension/commit/47b4c42916defc42a6704f3a1f3ee639b51742d3))

# [0.8.0](https://github.com/JuliaPluto/advanced-vscode-extension/compare/mcp-v0.7.1...mcp-v0.8.0) (2026-09-04)

### Bug Fixes

- **notebook:** bind the controller to a notebook before rendering results that arrive first ([5a6498b](https://github.com/JuliaPluto/advanced-vscode-extension/commit/5a6498ba4cf8b0dedf2d7177d951280b95347579))

### Features

- **cli:** argument files and relative-path resolution; cell edits and runs now go through Pluto ([f9aa28b](https://github.com/JuliaPluto/advanced-vscode-extension/commit/f9aa28bbce95c2a42027670a2955550224767ae2))

## [0.7.1](https://github.com/JuliaPluto/advanced-vscode-extension/compare/mcp-v0.7.0...mcp-v0.7.1) (2026-09-04)

### Bug Fixes

- **mcp:** read_cell_output honours the requested file extension; stop Julia first on shutdown ([#49](https://github.com/JuliaPluto/advanced-vscode-extension/issues/49)) ([c37bc47](https://github.com/JuliaPluto/advanced-vscode-extension/commit/c37bc478b65550f7f402b5825576899a71ec4723))

# [0.7.0](https://github.com/JuliaPluto/advanced-vscode-extension/compare/mcp-v0.6.0...mcp-v0.7.0) (2026-09-04)

### Features

- **mcp:** read_cell_output tool; cell results summarize outputs instead of inlining them ([#48](https://github.com/JuliaPluto/advanced-vscode-extension/issues/48)) ([0a78865](https://github.com/JuliaPluto/advanced-vscode-extension/commit/0a788651694487f95898fd7a522b61be83e653c5))

# [0.6.0](https://github.com/JuliaPluto/advanced-vscode-extension/compare/mcp-v0.5.5...mcp-v0.6.0) (2026-09-04)

### Bug Fixes

- **julia:** keep Julia's bundled depots when spawning the Pluto server ([#45](https://github.com/JuliaPluto/advanced-vscode-extension/issues/45)) ([9544a7e](https://github.com/JuliaPluto/advanced-vscode-extension/commit/9544a7eb2b2f8284c1328da49bee2db874ad7395))

### Features

- **cli:** status discovery, VS Code tool-server detection, strict args, cleaner help ([#46](https://github.com/JuliaPluto/advanced-vscode-extension/issues/46)) ([b114281](https://github.com/JuliaPluto/advanced-vscode-extension/commit/b114281edfe49c274851db5dde36a16a37c1cf94))
- night-shift roadmap — streamable HTTP, cell sync, terminal interrupt, review fixes ([6fa9b9b](https://github.com/JuliaPluto/advanced-vscode-extension/commit/6fa9b9b2782e0d3b5cc802a3c4181cbbb586e1eb))
