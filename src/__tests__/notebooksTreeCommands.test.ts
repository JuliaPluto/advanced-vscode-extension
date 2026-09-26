import { notebookPathOf } from "../commands/notebooksTreeCommands.ts";

describe("notebookPathOf", () => {
  it("takes the path a tree item's click passes", () => {
    expect(notebookPathOf("/w/nb.pluto.jl")).toBe("/w/nb.pluto.jl");
  });

  it("takes the tree item a context-menu entry passes", () => {
    expect(notebookPathOf({ notebookPath: "/w/nb.pluto.jl" })).toBe(
      "/w/nb.pluto.jl"
    );
  });
});
