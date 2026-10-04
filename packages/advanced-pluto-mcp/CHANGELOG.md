## [0.13.1](https://github.com/JuliaPluto/advanced-vscode-extension/compare/mcp-v0.13.0...mcp-v0.13.1) (2026-10-04)

### Bug Fixes

- **julia:** run on the user's Julia now that Pluto supports 1.13 ([63544d0](https://github.com/JuliaPluto/advanced-vscode-extension/commit/63544d06b91b7db7618c09304610647cdb48f121))

# [0.13.0](https://github.com/JuliaPluto/advanced-vscode-extension/compare/mcp-v0.12.0...mcp-v0.13.0) (2026-10-03)

### Bug Fixes

- **cli:** status checks the Pluto server the tool server reports ([#100](https://github.com/JuliaPluto/advanced-vscode-extension/issues/100)) ([2296ba9](https://github.com/JuliaPluto/advanced-vscode-extension/commit/2296ba9db7872352c0f1f746e3887d7162d8f2d3))
- **controller:** mount each result once ([#103](https://github.com/JuliaPluto/advanced-vscode-extension/issues/103)) ([6ead80c](https://github.com/JuliaPluto/advanced-vscode-extension/commit/6ead80c132ab2b0cb158a5cb03c88e92898735c0)), closes [#82](https://github.com/JuliaPluto/advanced-vscode-extension/issues/82) [#65](https://github.com/JuliaPluto/advanced-vscode-extension/issues/65)
- **manager:** address notebook operations by path; make getWorker total ([#107](https://github.com/JuliaPluto/advanced-vscode-extension/issues/107)) ([18f9db8](https://github.com/JuliaPluto/advanced-vscode-extension/commit/18f9db89b5014a505189eee1e60a7a1349039a26)), closes [#69](https://github.com/JuliaPluto/advanced-vscode-extension/issues/69) [#73](https://github.com/JuliaPluto/advanced-vscode-extension/issues/73)
- **mcp-config:** write MCP client config through one upsert module ([#85](https://github.com/JuliaPluto/advanced-vscode-extension/issues/85)) ([497d4ba](https://github.com/JuliaPluto/advanced-vscode-extension/commit/497d4ba559634d1271ccb11dbc62061e5cacbb0c)), closes [#72](https://github.com/JuliaPluto/advanced-vscode-extension/issues/72)
- **mcp:** bound edit_cell, read_cell_output and doc lookups by the execution timeout ([#91](https://github.com/JuliaPluto/advanced-vscode-extension/issues/91)) ([3483486](https://github.com/JuliaPluto/advanced-vscode-extension/commit/3483486e7eafa81066e9b7bcfdee05d770a61792)), closes [#67](https://github.com/JuliaPluto/advanced-vscode-extension/issues/67) [#38](https://github.com/JuliaPluto/advanced-vscode-extension/issues/38)
- **mcp:** bound every MCP tool call behind one tool seam, built once per server ([#102](https://github.com/JuliaPluto/advanced-vscode-extension/issues/102)) ([4889863](https://github.com/JuliaPluto/advanced-vscode-extension/commit/4889863ec5450d06cad7d57a09ae5f2037c84e1a)), closes [#67](https://github.com/JuliaPluto/advanced-vscode-extension/issues/67) [#73](https://github.com/JuliaPluto/advanced-vscode-extension/issues/73)
- **mcp:** check connect_to_pluto_server's url instead of dropping it ([#88](https://github.com/JuliaPluto/advanced-vscode-extension/issues/88)) ([dccb607](https://github.com/JuliaPluto/advanced-vscode-extension/commit/dccb60704759e751d6f1e78861550bb8b72d66c4)), closes [#74](https://github.com/JuliaPluto/advanced-vscode-extension/issues/74)
- **mcp:** refuse a relative create_notebook path before writing the file ([#109](https://github.com/JuliaPluto/advanced-vscode-extension/issues/109)) ([53856c2](https://github.com/JuliaPluto/advanced-vscode-extension/commit/53856c2bc130b2eb66e8105545c42d9572f2e1dc))
- **notebook:** make every new notebook file through newNotebookSource ([#87](https://github.com/JuliaPluto/advanced-vscode-extension/issues/87)) ([96e3aa9](https://github.com/JuliaPluto/advanced-vscode-extension/commit/96e3aa9d9a51d0158430e2dbfc93af686506d395)), closes [#77](https://github.com/JuliaPluto/advanced-vscode-extension/issues/77)
- **notebook:** send binary cell outputs through a JSON-safe transport ([#108](https://github.com/JuliaPluto/advanced-vscode-extension/issues/108)) ([96d86c2](https://github.com/JuliaPluto/advanced-vscode-extension/commit/96d86c2ce264382f6ae3b38d8f66b4bc958b4a7e)), closes [#70](https://github.com/JuliaPluto/advanced-vscode-extension/issues/70)
- **renderer:** keep live output DOM across VS Code re-mounts ([#99](https://github.com/JuliaPluto/advanced-vscode-extension/issues/99)) ([fcdffeb](https://github.com/JuliaPluto/advanced-vscode-extension/commit/fcdffeb77ec09e870b2514daebd8ca6716d9bf7c)), closes [#82](https://github.com/JuliaPluto/advanced-vscode-extension/issues/82)
- **renderer:** preserve binary image outputs ([#113](https://github.com/JuliaPluto/advanced-vscode-extension/issues/113)) ([5b1c1bd](https://github.com/JuliaPluto/advanced-vscode-extension/commit/5b1c1bde6546da02a6bb1c79996e81d8abc34335)), closes [#112](https://github.com/JuliaPluto/advanced-vscode-extension/issues/112)
- **server:** cancel a starting server from the status bar toggle ([#96](https://github.com/JuliaPluto/advanced-vscode-extension/issues/96)) ([20265ea](https://github.com/JuliaPluto/advanced-vscode-extension/commit/20265ea28cf765736a6fc25080561755faf099b3)), closes [#68](https://github.com/JuliaPluto/advanced-vscode-extension/issues/68) [#66](https://github.com/JuliaPluto/advanced-vscode-extension/issues/66)
- **server:** own one server state value in PlutoManager ([#92](https://github.com/JuliaPluto/advanced-vscode-extension/issues/92)) ([f2aba9c](https://github.com/JuliaPluto/advanced-vscode-extension/commit/f2aba9cbd42a33e24997e3f79d77fd2ca6126c90)), closes [#68](https://github.com/JuliaPluto/advanced-vscode-extension/issues/68)
- **terminal:** pin the webview's rainbow import to the bundled version ([#84](https://github.com/JuliaPluto/advanced-vscode-extension/issues/84)) ([d682f2e](https://github.com/JuliaPluto/advanced-vscode-extension/commit/d682f2ecfe0a28a49e331611d2dd5f66eb74cc51)), closes [#70](https://github.com/JuliaPluto/advanced-vscode-extension/issues/70)
- **terminal:** render outputs through the shared classification ([#110](https://github.com/JuliaPluto/advanced-vscode-extension/issues/110)) ([8ae1199](https://github.com/JuliaPluto/advanced-vscode-extension/commit/8ae1199459fe1d85eb06bbfa929436312a6c1fd3)), closes [#70](https://github.com/JuliaPluto/advanced-vscode-extension/issues/70)
- **tree:** open notebook from the context menu ([#93](https://github.com/JuliaPluto/advanced-vscode-extension/issues/93)) ([3c78c0e](https://github.com/JuliaPluto/advanced-vscode-extension/commit/3c78c0e83267c5131822f4484b855e96d42f8631))

### Features

- **cli:** take a tool's code argument from a file with --code-file ([#98](https://github.com/JuliaPluto/advanced-vscode-extension/issues/98)) ([e1242d5](https://github.com/JuliaPluto/advanced-vscode-extension/commit/e1242d56b672b42df0acfe6bb766f048a63c4837)), closes [#39](https://github.com/JuliaPluto/advanced-vscode-extension/issues/39)

# [0.12.0](https://github.com/JuliaPluto/advanced-vscode-extension/compare/mcp-v0.11.1...mcp-v0.12.0) (2026-09-15)

### Features

- **server:** single writer for notebook files, warn on unsupported Julia ([#81](https://github.com/JuliaPluto/advanced-vscode-extension/issues/81)) ([fcaaf11](https://github.com/JuliaPluto/advanced-vscode-extension/commit/fcaaf1169616718f47e6d4124ce873244a2c42ed)), closes [#60](https://github.com/JuliaPluto/advanced-vscode-extension/issues/60) [#39](https://github.com/JuliaPluto/advanced-vscode-extension/issues/39)

## [0.11.1](https://github.com/JuliaPluto/advanced-vscode-extension/compare/mcp-v0.11.0...mcp-v0.11.1) (2026-09-15)

### Bug Fixes

- **server:** stop false Dyad channel warning when juliaup resolves the channel path ([#80](https://github.com/JuliaPluto/advanced-vscode-extension/issues/80)) ([96b2a7a](https://github.com/JuliaPluto/advanced-vscode-extension/commit/96b2a7a971b89a7cb6ca36d3b37a4348b1185158))

# [0.11.0](https://github.com/JuliaPluto/advanced-vscode-extension/compare/mcp-v0.10.1...mcp-v0.11.0) (2026-09-14)

### Features

- **mcp:** send server instructions with the MCP handshake ([#79](https://github.com/JuliaPluto/advanced-vscode-extension/issues/79)) ([393d6c9](https://github.com/JuliaPluto/advanced-vscode-extension/commit/393d6c99f88b27a1bf3eeab75bef7b2ae7499149))

## [0.10.1](https://github.com/JuliaPluto/advanced-vscode-extension/compare/mcp-v0.10.0...mcp-v0.10.1) (2026-09-12)

### Bug Fixes

- **server:** open local notebooks in place and keep the embedded package env on save ([#61](https://github.com/JuliaPluto/advanced-vscode-extension/issues/61)) ([8348dbc](https://github.com/JuliaPluto/advanced-vscode-extension/commit/8348dbc778c7c6fb060b4152aad6665370c421b5)), closes [#60](https://github.com/JuliaPluto/advanced-vscode-extension/issues/60) [#39](https://github.com/JuliaPluto/advanced-vscode-extension/issues/39)

# [0.10.0](https://github.com/JuliaPluto/advanced-vscode-extension/compare/mcp-v0.9.0...mcp-v0.10.0) (2026-09-12)

### Bug Fixes

- **notebook:** collapse folded cells through VS Code's own commands ([5955542](https://github.com/JuliaPluto/advanced-vscode-extension/commit/59555426dd5315a897e56dbed77e7383f3e33d4b))

### Features

- **mcp:** expose the MCP server natively to VS Code and open notebooks in the Simple Browser ([#59](https://github.com/JuliaPluto/advanced-vscode-extension/issues/59)) ([f4c6424](https://github.com/JuliaPluto/advanced-vscode-extension/commit/f4c64246a2782b5c456a0b019d068c40b163d54e)), closes [#57](https://github.com/JuliaPluto/advanced-vscode-extension/issues/57) [#58](https://github.com/JuliaPluto/advanced-vscode-extension/issues/58)

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
