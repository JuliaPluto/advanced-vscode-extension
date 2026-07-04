# Upstream notes for @plutojl/rainbow

Two defects found while hardening this extension live in rainbow itself. Both are
worked around here; fixing them upstream would let us delete the workarounds.

## 1. `waitSnippet` misses the terminal update of fast cells (hang)

**Symptom:** `waitSnippet(index, code)` never resolves for a cell that finishes
quickly, even though the cell ran fine (`cell_results` shows terminal state,
`last_run_timestamp` set). Observed consistently on workers attached via
`host.worker(id)` to an existing notebook; the same race exists in principle for
`createWorker` flows.

**Cause:** `waitSnippet` first `await`s `addSnippet(...)` (a full
`update_notebook` + `run_multiple_cells` round trip) and only **then** registers
its `onUpdate` listener. A trivial cell (`x * 2`) reaches terminal state within
that round-trip window, so the listener registers after the last
`notebook_updated` event for that cell has already fired. With no further update
traffic on the socket, the promise never settles. (`wait(ready)` has the same
listener-after-check shape but re-checks `isIdle()` first, so it is less
exposed.)

**Suggested fix:** register the `onUpdate` listener _before_ awaiting
`addSnippet`, or after registration re-check
`isTerminalStatus(getStatus(this, cell_id))` once synchronously and resolve
immediately if already terminal.

**Workaround in this repo:** `PlutoManager.runSnippet`
(src/plutoManager.ts) races `waitSnippet` against a 250ms state poll on
`getSnippet(cellId).result` (terminal := `!running && !queued &&
output.last_run_timestamp > 0`).

## 2. `serialize()` does not round-trip the embedded package environment

**Symptom:** a notebook file containing `PLUTO_PROJECT_TOML_CONTENTS` /
`PLUTO_MANIFEST_TOML_CONTENTS` cells, opened via `/notebookupload` or
`SessionActions.open`, loses those cells when the state is re-serialized with
rainbow's `serialize(notebookData)` — the saved notebook is no longer
self-contained (reported by a user of the MCP `save_notebook` tool, issue #39).

**Cause:** `NotebookData.nbpkg`/package cells are parsed (`_package_cells` is
kept by `parse()`) but `serialize()` does not re-emit the Project/Manifest
special cells (`00000000-0000-0000-0000-00000000000{1,2}`) from live worker
state, where nbpkg TOML isn't part of `cell_inputs`.

**Suggested fix:** have `serialize()` emit the embedded environment when
`notebook_state.nbpkg` (or the parsed `_package_cells`) is present — matching
Pluto's own `save_notebook` output.

**Workaround in this repo:** none — documented as a known limitation of
`save_notebook`; users splice the env cells back manually.
