/** Must match `contributes.notebooks[].selector[].filenamePattern` in package.json. */
export const PLUTO_NOTEBOOK_EXTENSIONS = ["pluto.jl", "dyad.jl"] as const;

export function isPlutoNotebookFileName(fileName: string): boolean {
  return PLUTO_NOTEBOOK_EXTENSIONS.some((ext) => fileName.endsWith(`.${ext}`));
}

/** File-dialog filter offering exactly the files that open as Pluto notebooks. */
export const PLUTO_NOTEBOOK_FILTERS = {
  "Pluto Notebooks": [...PLUTO_NOTEBOOK_EXTENSIONS],
};
