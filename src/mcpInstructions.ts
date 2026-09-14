/**
 * What the server tells a client about itself, before any tool is called.
 *
 * A tool description reaches a model only once it is already reading that
 * tool, and `learn_pluto_basics` reaches one only if it chooses to call it.
 * These lines arrive with the handshake, while the client is still deciding
 * what to do — so they carry the rules whose cost is paid before any tool
 * description could have been read: that nothing is saved unless asked, that
 * a timeout is not a failure, and that retrying a timed-out create_cell
 * defines the same variable twice.
 *
 * Everything else stays in PLUTO_GUIDE.md behind `learn_pluto_basics`; this
 * text is sent on every session and is kept to what a client cannot afford
 * to learn by trying.
 */
export const MCP_SERVER_INSTRUCTIONS = `Julia notebooks running in Pluto, driving the same Pluto server the editor is
attached to — a notebook opened here is the one the user has in front of them,
and a cell edited here updates in their tab as it happens.

learn_pluto_basics holds the full guide: reactivity, PlutoUI, package
environments, plots, and the recommended workflow. Read it before building a
notebook. What follows is only what is expensive to discover by trying.

Starting up:
- The first start_pluto_server of a session installs and precompiles Julia
  packages, which takes minutes. A tool call that times out during it has not
  failed; get_notebook_status says whether the server is still coming up.

Saving:
- Nothing is auto-saved. Every mutation lives in the running notebook until
  save_notebook writes it out, so a notebook built entirely through these
  tools is still whatever was last written to disk.
- Pluto owns the .pluto.jl file while the notebook is open. Edits made to it
  on disk are ignored or overwritten; go through create_cell, edit_cell and
  delete_cell instead.

Reactivity:
- A variable may be defined in exactly one cell, notebook-wide. Several
  statements belong in one begin ... end cell rather than in several cells.
- Editing a cell re-runs every cell that depends on it, so a single edit can
  start a cascade that outlives the call that triggered it.

Waiting:
- create_cell, execute_cell and execute_code return after five minutes with
  timed_out set, and the computation keeps running server-side.
- Call wait_for_notebook_idle once instead of polling list_cells or read_cell
  in a loop.
- A create_cell that timed out still created its cell. Retrying it defines the
  same variable twice; list_cells finds the cell and delete_cell removes it.

Package environments:
- Plain \`using Foo\` is enough — Pluto installs and pins it.
- Once any cell calls Pkg.activate, that automatic installation is off for the
  whole notebook and every package must come from the activated environment.
  Keep the activation and all of its \`using\` lines in one begin ... end cell.

Paths:
- Path arguments must be absolute: Pluto identifies a notebook by its absolute
  path and cannot resolve a relative one against your working directory.
- Inside a cell, @__DIR__ is the notebook's own directory; pwd() is the
  server's and is not it.

Reading output:
- Cell results are summarized — long text and tree views are cut, and images
  come back as a mime type and a byte count. read_cell_output returns the whole
  output: as "image" to see a plot, "file" to put it on disk, "text" for full
  markup.`;
