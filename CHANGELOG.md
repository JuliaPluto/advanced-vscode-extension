## [0.2.1](https://github.com/JuliaPluto/advanced-vscode-extension/compare/v0.2.0...v0.2.1) (2025-10-28)

### Bug Fixes

- use ProcessExecution to avoid shell quote issues ([d30bcac](https://github.com/JuliaPluto/advanced-vscode-extension/commit/d30bcac058978754cf51a70b56419496d6d7b706))

# [0.2.0](https://github.com/JuliaPluto/advanced-vscode-extension/compare/v0.1.2...v0.2.0) (2025-10-26)

### Features

- windows installation working (after juliaup) ([03bc90f](https://github.com/JuliaPluto/advanced-vscode-extension/commit/03bc90fe5b0bed9540d5f9c84604e25bcad8b577))

## [0.1.2](https://github.com/JuliaPluto/advanced-vscode-extension/compare/v0.1.1...v0.1.2) (2025-10-25)

### Bug Fixes

- do our own setup on julia 1.11.7 ([ecf1da2](https://github.com/JuliaPluto/advanced-vscode-extension/commit/ecf1da209d86c31bf6e06d86257b019c608425bc))
- make pluto-notebook's default julia version a setting ([3f972e4](https://github.com/JuliaPluto/advanced-vscode-extension/commit/3f972e4b8ab71b48b1563c8c94cc37ca6a92a291))
- remove usage of node's fs, in favor of VSCode apis ([6248445](https://github.com/JuliaPluto/advanced-vscode-extension/commit/62484450ea5c4e72fccc2a4d8c3c9f6d1c8bcdbe))
- reorganize to sanitize and limit polyfill usage, include new rainbow ([4b027a0](https://github.com/JuliaPluto/advanced-vscode-extension/commit/4b027a057771efb3c9faee894cd3beae306b93c5))

## [0.1.1](https://github.com/JuliaPluto/advanced-vscode-extension/compare/v0.1.0...v0.1.1) (2025-10-24)

### Bug Fixes

- relax vscode version ([9bfbdf8](https://github.com/JuliaPluto/advanced-vscode-extension/commit/9bfbdf89d146a14324031d2722e38e7dc86cdf86))

# [0.1.0](https://github.com/JuliaPluto/advanced-vscode-extension/compare/v0.0.7...v0.1.0) (2025-10-24)

### Features

- add notebook introspect and get_docs tool ([ee7b8f4](https://github.com/JuliaPluto/advanced-vscode-extension/commit/ee7b8f4e8f7fe27d4d2cf8e6d8159a72a39cbc6f))

## [0.0.7](https://github.com/JuliaPluto/advanced-vscode-extension/compare/v0.0.6...v0.0.7) (2025-10-17)

### Bug Fixes

- do less state resets ([#18](https://github.com/JuliaPluto/advanced-vscode-extension/issues/18)) ([7ef3707](https://github.com/JuliaPluto/advanced-vscode-extension/commit/7ef37077aa593440c889eb8b28dd7b4c1d465a1d))

## [0.0.6](https://github.com/JuliaPluto/advanced-vscode-extension/compare/v0.0.5...v0.0.6) (2025-10-14)

### Bug Fixes

- release 0.0.6 ([dd1c89a](https://github.com/JuliaPluto/advanced-vscode-extension/commit/dd1c89a1eb80126bddc5172ab1154d01419b8323))

# Changelog

All notable changes to the Pluto Notebook VSCode extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Create New Notebook command to generate new Pluto notebooks with a single empty cell ([3bcaf2d](https://github.com/JuliaPluto/advanced-vscode-extension/commit/3bcaf2d))

### Fixed

- CI workflow now uses PAT with bypass permissions for protected branch ([46e57a7](https://github.com/JuliaPluto/advanced-vscode-extension/commit/46e57a7))
- Manage reset state patch for improved state handling ([a7240eb](https://github.com/JuliaPluto/advanced-vscode-extension/commit/a7240eb))

### Changed

- Re-enabled semantic release version bumping with proper configuration ([e0a2a72](https://github.com/JuliaPluto/advanced-vscode-extension/commit/e0a2a72))

## [0.1.0-alpha] - 2025-10-12

Initial alpha release of the Pluto Notebook VSCode extension.

**⚠️ Alpha Release Notice:** This is an early alpha version. Features are functional but may contain bugs. Not recommended for production use.

### Added

- Pluto Notebook support for `.pluto.jl` and `.dyad.jl` files ([9467309](https://github.com/JuliaPluto/advanced-vscode-extension/commit/9467309))
- Integrated Pluto server with automatic lifecycle management
- VSCode task integration for Pluto server (terminal-based) ([0ce78b4](https://github.com/JuliaPluto/advanced-vscode-extension/commit/0ce78b4))
- Interactive terminal for Julia code execution with command history ([2c93203](https://github.com/JuliaPluto/advanced-vscode-extension/commit/2c93203))
- Rich output rendering (HTML, images, plots) in webviews
- HTTP-based MCP server for AI assistant integration
- 11 VS Code commands for server, configuration, and notebook management
- 12 MCP tools for AI assistants
- Real-time and ephemeral code execution
- Interactive config generation for Claude Desktop and GitHub Copilot
- Open notebook in browser command
- Health check endpoint
- Configuration settings for ports and auto-start
- Shared state between extension and MCP clients
- Code snippets for Pluto and Dyad Interface components
- Automatic port selection to avoid conflicts
- Toggle view command to switch between code and notebook view
- Pluto Notebooks tree view in explorer with hierarchy information and definitions ([5c0313d](https://github.com/JuliaPluto/advanced-vscode-extension/commit/5c0313d))
- Reconnect notebook functionality
- Status bar integration ([5341d45](https://github.com/JuliaPluto/advanced-vscode-extension/commit/5341d45))
- MathJax support for mathematical notation ([73ead4a](https://github.com/JuliaPluto/advanced-vscode-extension/commit/73ead4a))
- Synchronous logs, stdout, and progress display ([a606e59](https://github.com/JuliaPluto/advanced-vscode-extension/commit/a606e59))
- Native support for images and bonds ([96c166d](https://github.com/JuliaPluto/advanced-vscode-extension/commit/96c166d))
- Optional connection to local URL instead of spawning server ([5ef432b](https://github.com/JuliaPluto/advanced-vscode-extension/commit/5ef432b))

### Fixed

- Multiple open editors handling ([da1f7b9](https://github.com/JuliaPluto/advanced-vscode-extension/commit/da1f7b9))
- Output display on notebook reopen ([ad6e488](https://github.com/JuliaPluto/advanced-vscode-extension/commit/ad6e488))
- Value display after error state ([b8cd536](https://github.com/JuliaPluto/advanced-vscode-extension/commit/b8cd536))
- Tree view error handling ([2ba1da8](https://github.com/JuliaPluto/advanced-vscode-extension/commit/2ba1da8))
- UUID validation compatibility with Julia ([333531d](https://github.com/JuliaPluto/advanced-vscode-extension/commit/333531d))
- Linting issues with isDefined/isNotDefined usage ([fff6b6f](https://github.com/JuliaPluto/advanced-vscode-extension/commit/fff6b6f))
- Conditional checks and markdown serialization ([8cd0d2e](https://github.com/JuliaPluto/advanced-vscode-extension/commit/8cd0d2e))
- Task start functionality ([299f8c6](https://github.com/JuliaPluto/advanced-vscode-extension/commit/299f8c6))
- Tests and markdown handling ([0160cf5](https://github.com/JuliaPluto/advanced-vscode-extension/commit/0160cf5))
- Jest environment configuration ([37f5bfc](https://github.com/JuliaPluto/advanced-vscode-extension/commit/37f5bfc))
- Pluto terminal error handling ([f474fd0](https://github.com/JuliaPluto/advanced-vscode-extension/commit/f474fd0))
- Worker shutdown using process termination instead of connection close ([5aa73d6](https://github.com/JuliaPluto/advanced-vscode-extension/commit/5aa73d6))
- Image serialization issues ([9240509](https://github.com/JuliaPluto/advanced-vscode-extension/commit/9240509))
- ArrayBuffer to string conversion moved to controller ([4cc3b3f](https://github.com/JuliaPluto/advanced-vscode-extension/commit/4cc3b3f))
- Pluto-tree styles refinements ([426f0a6](https://github.com/JuliaPluto/advanced-vscode-extension/commit/426f0a6), [ebe31c0](https://github.com/JuliaPluto/advanced-vscode-extension/commit/ebe31c0))
- TypeScript type definitions ([9937fb3](https://github.com/JuliaPluto/advanced-vscode-extension/commit/9937fb3))

### Changed

- Reset error state automatically ([2d251dc](https://github.com/JuliaPluto/advanced-vscode-extension/commit/2d251dc))
- Hide Pluto AI interface in embedded views ([8388eaa](https://github.com/JuliaPluto/advanced-vscode-extension/commit/8388eaa))
- Remove icons from tree view ([de43faa](https://github.com/JuliaPluto/advanced-vscode-extension/commit/de43faa))
- Improved styling for webviews ([ec94551](https://github.com/JuliaPluto/advanced-vscode-extension/commit/ec94551))
- Code formatting with Prettier ([95b5f29](https://github.com/JuliaPluto/advanced-vscode-extension/commit/95b5f29), [fe7211b](https://github.com/JuliaPluto/advanced-vscode-extension/commit/fe7211b), [b1d09a7](https://github.com/JuliaPluto/advanced-vscode-extension/commit/b1d09a7))
- ESLint configuration and cleanup ([14b2b44](https://github.com/JuliaPluto/advanced-vscode-extension/commit/14b2b44), [a92c8af](https://github.com/JuliaPluto/advanced-vscode-extension/commit/a92c8af))
- Better notebook management ([875f317](https://github.com/JuliaPluto/advanced-vscode-extension/commit/875f317))
- Tree view refactoring ([a2e52e1](https://github.com/JuliaPluto/advanced-vscode-extension/commit/a2e52e1))
- Enhanced styling for `pre` and `pluto-tree` elements ([2c9a7d5](https://github.com/JuliaPluto/advanced-vscode-extension/commit/2c9a7d5))
- General style updates and refinements ([2c1f723](https://github.com/JuliaPluto/advanced-vscode-extension/commit/2c1f723), [5ffef03](https://github.com/JuliaPluto/advanced-vscode-extension/commit/5ffef03))

### Documentation

- Comprehensive MCP server guide (docs/MCP.md)
- Interactive terminal guide (docs/TERMINAL.md)
- Pluto server task integration guide (docs/PLUTO-SERVER-TASK.md)
- Development guide (CLAUDE.md)
- Contributing guidelines (docs/CONTRIBUTING.md)
- Semantic release workflow (docs/SEMANTIC_RELEASE.md)
- Pluto.jl guide for AI tools with PlutoUI components reference
- Updated README with extension overview and complete feature list ([e69c775](https://github.com/JuliaPluto/advanced-vscode-extension/commit/e69c775), [8596f60](https://github.com/JuliaPluto/advanced-vscode-extension/commit/8596f60))
- Improved code comments ([9129c44](https://github.com/JuliaPluto/advanced-vscode-extension/commit/9129c44))

### CI/CD

- Complete CI/CD pipeline with GitHub Actions ([8736c3d](https://github.com/JuliaPluto/advanced-vscode-extension/commit/8736c3d))
- Automated releases with semantic-release ([a2c2855](https://github.com/JuliaPluto/advanced-vscode-extension/commit/a2c2855))
- Commitlint for conventional commits
- ESLint and Prettier checks in CI ([a92c8af](https://github.com/JuliaPluto/advanced-vscode-extension/commit/a92c8af))
- Unit tests in CI pipeline ([c5f61bf](https://github.com/JuliaPluto/advanced-vscode-extension/commit/c5f61bf))
- TypeScript type checking and linting fixes ([4493719](https://github.com/JuliaPluto/advanced-vscode-extension/commit/4493719))
- VSIX artifact generation and attachment to releases

### Dependencies

- Upgraded @plutojl/rainbow to 0.6.10 ([b504340](https://github.com/JuliaPluto/advanced-vscode-extension/commit/b504340))
- Upgraded @plutojl/rainbow to 0.6.8 ([048fdea](https://github.com/JuliaPluto/advanced-vscode-extension/commit/048fdea))
