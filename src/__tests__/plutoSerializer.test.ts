import {
  parsePlutoNotebook,
  serializePlutoNotebook,
  isMarkdownCell,
} from "../plutoSerializer.ts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { type NotebookCellData, NotebookCellKind } from "vscode";
import { v4 as uuidv4 } from "uuid";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("Pluto Serializer Functions", () => {
  let demoNotebookContent: string;

  beforeAll(() => {
    // Load the demo.jl file
    const demoPath = join(__dirname, "../../examples/demo.jl");
    demoNotebookContent = readFileSync(demoPath, "utf8");
  });

  describe("isMarkdownCell", () => {
    it("should detect markdown cells", () => {
      expect(isMarkdownCell('#VSCODE-MARKDOWN\n\nmd"""# Hello"""')).toBe(true);
      expect(isMarkdownCell('  #VSCODE-MARKDOWN\n\tmd"""content"""')).toBe(
        true
      );
      expect(isMarkdownCell('\t#VSCODE-MARKDOWN \nmd"""content"""')).toBe(true);
    });

    it("should not detect code cells as markdown", () => {
      expect(isMarkdownCell("x = 1")).toBe(false);
      expect(isMarkdownCell('println("hello")')).toBe(false);
      expect(isMarkdownCell("using Plots")).toBe(false);
    });
  });

  describe("parsePlutoNotebook with demo.jl", () => {
    let parsed: ReturnType<typeof parsePlutoNotebook>;

    beforeAll(async () => {
      parsed = parsePlutoNotebook(demoNotebookContent);
    });

    it("should parse demo notebook successfully", () => {
      expect(parsed).toBeDefined();
      expect(parsed.cells).toBeDefined();
      expect(Array.isArray(parsed.cells)).toBe(true);
    });

    it("should have cells", () => {
      expect(parsed.cells.length).toBeGreaterThan(0);
      console.log(`Parsed ${parsed.cells.length} cells from demo.jl`);
    });

    it("should have notebook metadata", () => {
      expect(parsed.notebook_id).toBeDefined();
      expect(typeof parsed.notebook_id).toBe("string");
    });

    it("should detect markdown cells", () => {
      const markdownCells = parsed.cells.filter(
        (c) => c.kind === NotebookCellKind.Markup
      );
      expect(markdownCells.length).toBeGreaterThan(0);
      console.log(`Found ${markdownCells.length} markdown cells`);
    });

    it("should detect code cells", () => {
      const codeCells = parsed.cells.filter(
        (c) => c.kind === NotebookCellKind.Code
      );
      expect(codeCells.length).toBeGreaterThan(0);
      console.log(`Found ${codeCells.length} code cells`);
    });

    it("should preserve cell IDs", () => {
      for (const cell of parsed.cells) {
        expect(typeof cell.metadata?.pluto_cell_id).toBe("string");
      }
    });

    it("should preserve cell code", () => {
      for (const cell of parsed.cells) {
        expect(cell.value).toBeDefined();
        expect(typeof cell.value).toBe("string");
      }
    });

    it("should have specific demo cells", () => {
      // Check for title cell
      const titleCell = parsed.cells.find((c) =>
        c.value.includes("Pluto Notebook Demo")
      );
      expect(titleCell).toBeDefined();
      expect(titleCell?.kind).toBe(NotebookCellKind.Markup);
    });

    it("should have variable declarations", () => {
      const xCell = parsed.cells.find((c) => c.value.includes("x = 5"));
      expect(xCell).toBeDefined();
      expect(xCell?.kind).toBe(NotebookCellKind.Code);
    });

    it("should have PlutoUI widgets", () => {
      const sliderCell = parsed.cells.find(
        (c) => c.value.includes("@bind") && c.value.includes("Slider")
      );
      expect(sliderCell).toBeDefined();
    });

    it("should have plotting code", () => {
      const plotCells = parsed.cells.filter(
        (c) =>
          c.value.includes("plot(") ||
          c.value.includes("scatter(") ||
          c.value.includes("heatmap(")
      );
      expect(plotCells.length).toBeGreaterThan(0);
      console.log(`Found ${plotCells.length} plotting cells`);
    });
  });

  describe("serializePlutoNotebook", () => {
    it("should serialize simple cells", async () => {
      const cells: NotebookCellData[] = [
        {
          languageId: "julia",
          value: "x = 1",
          kind: NotebookCellKind.Code,
          metadata: { pluto_cell_id: uuidv4() },
        },
        {
          languageId: "julia",
          value: "y = x + 1",
          kind: NotebookCellKind.Code,
          metadata: { pluto_cell_id: uuidv4() },
        },
      ];

      const serialized = serializePlutoNotebook(cells);

      expect(serialized).toBeDefined();
      expect(typeof serialized).toBe("string");
      expect(serialized).toContain("### A Pluto.jl notebook ###");
      expect(serialized).toContain("x = 1");
      expect(serialized).toContain("y = x + 1");
      expect(serialized).toContain("╔═╡");
      expect(serialized).toContain("Cell order:");
    });

    it("should serialize markdown cells", async () => {
      const cells: NotebookCellData[] = [
        {
          languageId: "julia",
          value: "\n# Title\n",
          kind: NotebookCellKind.Markup,
          metadata: { pluto_cell_id: uuidv4() },
        },
      ];

      const serialized = serializePlutoNotebook(cells);

      expect(serialized).toContain('md"""');
      expect(serialized).toContain("# Title");
    });

    it("should generate IDs for cells without them", async () => {
      const cells: NotebookCellData[] = [
        {
          languageId: "julia",
          value: "y = x + 1",
          kind: NotebookCellKind.Code,
          metadata: {},
        },
      ];

      const serialized = serializePlutoNotebook(cells);

      expect(serialized).toContain("y = x + 1");
      // Should contain a valid UUID in the cell marker
      expect(serialized).toMatch(
        /# ╔═╡ [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
      );
    });
  });

  describe("Round-trip with demo.jl", () => {
    it("should parse and serialize demo notebook without data loss", async () => {
      // Parse
      const parsed = parsePlutoNotebook(demoNotebookContent);

      expect(parsed.cells.length).toBeGreaterThan(0);
      const originalCellCount = parsed.cells.length;
      const originalFirstCell = parsed.cells[0].value;
      const originalLastCell = parsed.cells[parsed.cells.length - 1].value;

      // Serialize
      const serialized = serializePlutoNotebook(
        parsed.cells,
        parsed.notebook_id,
        parsed.pluto_version
      );

      expect(serialized).toBeDefined();
      expect(serialized.length).toBeGreaterThan(0);

      // Parse again
      const reParsed = parsePlutoNotebook(serialized);

      expect(reParsed.cells.length).toBe(originalCellCount);
      expect(reParsed.cells[0].value).toBe(originalFirstCell);
      expect(reParsed.cells[reParsed.cells.length - 1].value).toBe(
        originalLastCell
      );
    });

    it("should preserve cell order", async () => {
      const parsed = parsePlutoNotebook(demoNotebookContent);
      const originalOrder = parsed.cells.map((c) => c.metadata?.pluto_cell_id);

      const serialized = serializePlutoNotebook(
        parsed.cells,
        parsed.notebook_id,
        parsed.pluto_version
      );

      const reParsed = parsePlutoNotebook(serialized);
      const newOrder = reParsed.cells.map((c) => c.metadata?.pluto_cell_id);

      expect(newOrder).toEqual(originalOrder);
    });

    it("should preserve markdown and code cell types", async () => {
      const parsed = parsePlutoNotebook(demoNotebookContent);
      const originalTypes = parsed.cells.map((c) => c.kind);

      const serialized = serializePlutoNotebook(
        parsed.cells,
        parsed.notebook_id,
        parsed.pluto_version
      );

      const reParsed = parsePlutoNotebook(serialized);
      const newTypes = reParsed.cells.map((c) => c.kind);

      expect(newTypes).toEqual(originalTypes);
    });

    it("should preserve specific cell content", async () => {
      const parsed = parsePlutoNotebook(demoNotebookContent);

      // Find specific cells
      const xCell = parsed.cells.find((c) => c.value.includes("x = 5"));
      const titleCell = parsed.cells.find((c) =>
        c.value.includes("Pluto Notebook Demo")
      );

      expect(xCell).toBeDefined();
      expect(titleCell).toBeDefined();

      // Serialize and re-parse
      const serialized = serializePlutoNotebook(
        parsed.cells,
        parsed.notebook_id,
        parsed.pluto_version
      );
      const reParsed = parsePlutoNotebook(serialized);

      // Verify cells still exist
      const xCellAfter = reParsed.cells.find((c) => c.value.includes("x = 5"));
      const titleCellAfter = reParsed.cells.find((c) =>
        c.value.includes("Pluto Notebook Demo")
      );

      expect(xCellAfter).toBeDefined();
      expect(titleCellAfter).toBeDefined();
      expect(xCellAfter?.kind).toBe(NotebookCellKind.Code);
      expect(titleCellAfter?.kind).toBe(NotebookCellKind.Markup);
    });
  });

  describe("cell metadata round-trip (issue #28)", () => {
    it("does not write pluto_cell_id or default metadata as TOML annotations", () => {
      const cellId = uuidv4();
      const cell: NotebookCellData = {
        kind: NotebookCellKind.Code,
        value: "x = 1",
        languageId: "julia",
        metadata: { pluto_cell_id: cellId },
      };

      const serialized = serializePlutoNotebook([cell], uuidv4(), "0.20.21");

      expect(serialized).not.toContain("pluto_cell_id =");
      expect(serialized).not.toContain("show_logs");
      expect(serialized).not.toContain("skip_as_script");
      // The cell id must still appear as the cell marker
      expect(serialized).toContain(`# ╔═╡ ${cellId}`);
    });

    it("preserves real Pluto metadata like disabled", () => {
      const cell: NotebookCellData = {
        kind: NotebookCellKind.Code,
        value: "x = 1",
        languageId: "julia",
        metadata: { pluto_cell_id: uuidv4(), disabled: true },
      };

      const serialized = serializePlutoNotebook([cell], uuidv4(), "0.20.21");
      expect(serialized).toContain("disabled = true");
      expect(serialized).not.toContain("pluto_cell_id =");
    });

    it("round-trips code_folded through cell metadata", () => {
      const cellId = uuidv4();
      const notebook = `### A Pluto.jl notebook ###
# v0.20.21

using Markdown
using InteractiveUtils

# ╔═╡ ${cellId}
x = 1

# ╔═╡ Cell order:
# ╟─${cellId}
`;

      const parsed = parsePlutoNotebook(notebook);
      expect(parsed.cells[0].metadata?.code_folded).toBe(true);

      const serialized = serializePlutoNotebook(
        parsed.cells,
        parsed.notebook_id,
        parsed.pluto_version
      );
      // Folded cells appear with the folded marker in the cell order
      expect(serialized).toContain(`# ╟─${cellId}`);
      expect(serialized).not.toContain("code_folded =");
    });

    it("self-heals files poisoned with embedded pluto_cell_id metadata", () => {
      const markerId = uuidv4();
      const staleId = uuidv4();
      const notebook = `### A Pluto.jl notebook ###
# v0.20.21

using Markdown
using InteractiveUtils

# ╔═╡ ${markerId}
# ╠═╡ show_logs = false
# ╠═╡ pluto_cell_id = "${staleId}"
b = 1

# ╔═╡ Cell order:
# ╠═${markerId}
`;

      const parsed = parsePlutoNotebook(notebook);
      // The marker-derived id wins over the stale embedded one
      expect(parsed.cells[0].metadata?.pluto_cell_id).toBe(markerId);

      const serialized = serializePlutoNotebook(
        parsed.cells,
        parsed.notebook_id,
        parsed.pluto_version
      );
      expect(serialized).not.toContain("pluto_cell_id =");
      // Non-default show_logs=false from the file is preserved
      expect(serialized).toContain("show_logs = false");
    });
  });

  describe("Error handling", () => {
    it("should handle empty content", async () => {
      expect(() => parsePlutoNotebook("")).toThrow();
    });

    it("should handle invalid notebook", async () => {
      expect(() => parsePlutoNotebook("invalid content")).toThrow();
    });

    it("should handle notebook without cell order", async () => {
      const notebook = `### A Pluto.jl notebook ###
# v0.19.40

using Markdown
using InteractiveUtils

# ╔═╡ ${uuidv4()}
x = 1`;

      const parsed = parsePlutoNotebook(notebook);
      expect(parsed).toBeDefined();
      // Cell order might be inferred or empty
    });
  });
});

describe("folded cells ↔ VS Code collapsed input", () => {
  const src = `### A Pluto.jl notebook ###
# v0.20.0

using Markdown
using InteractiveUtils

# ╔═╡ aaaaaaaa-0000-0000-0000-000000000001
x = 1

# ╔═╡ bbbbbbbb-0000-0000-0000-000000000002
md"""
# Title
"""

# ╔═╡ Cell order:
# ╟─bbbbbbbb-0000-0000-0000-000000000002
# ╠═aaaaaaaa-0000-0000-0000-000000000001
`;

  it("collapses folded cells by default and leaves the rest alone", () => {
    const parsed = parsePlutoNotebook(src);
    const [title, code] = parsed.cells;
    expect(title.metadata?.code_folded).toBe(true);
    expect(title.metadata?.inputCollapsed).toBe(true);
    expect(code.metadata?.code_folded).toBe(false);
    expect(code.metadata?.inputCollapsed).toBeUndefined();
  });

  it("does not touch the collapsed state when the option is off", () => {
    const parsed = parsePlutoNotebook(src, { foldHiddenCells: false });
    expect(parsed.cells[0].metadata?.code_folded).toBe(true);
    expect(parsed.cells[0].metadata?.inputCollapsed).toBeUndefined();
  });

  it("writes the editor's collapsed state back as the fold marker", () => {
    const cells = parsePlutoNotebook(src).cells;
    // user expanded the title cell and collapsed the code cell
    cells[0].metadata = { ...cells[0].metadata, inputCollapsed: false };
    cells[1].metadata = {
      ...cells[1].metadata,
      inputCollapsed: true,
      outputCollapsed: true,
    };
    const out = serializePlutoNotebook(cells, "nb", "0.20.0");
    expect(out).toContain("# ╠═bbbbbbbb-0000-0000-0000-000000000002");
    expect(out).toContain("# ╟─aaaaaaaa-0000-0000-0000-000000000001");
    expect(out).not.toContain("inputCollapsed");
    expect(out).not.toContain("outputCollapsed");
  });

  it("ignores the collapsed state when the option is off", () => {
    const cells = parsePlutoNotebook(src, { foldHiddenCells: false }).cells;
    cells[0].metadata = { ...cells[0].metadata, inputCollapsed: false };
    const out = serializePlutoNotebook(cells, "nb", "0.20.0", {
      foldHiddenCells: false,
    });
    expect(out).toContain("# ╟─bbbbbbbb-0000-0000-0000-000000000002");
    expect(out).not.toContain("inputCollapsed");
  });
});
