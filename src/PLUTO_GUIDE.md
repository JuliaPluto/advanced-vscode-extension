# Pluto.jl Notebook Guide for AI Tools

This guide explains how to work with Pluto.jl notebooks, including cell structure, reactivity rules, PlutoUI components, and best practices.

## Important: Server Startup Times

Starting a Pluto server involves installing Julia packages and precompiling them. **The first run can take several minutes** (2-10 minutes depending on the system). If `start_pluto_server` or `open_notebook` appears to hang or times out:

1. **Do not retry immediately** — the server is likely still starting up.
2. **Wait 30-60 seconds**, then call `get_notebook_status` to check progress.
3. **Subsequent runs are much faster** since packages are cached.

If a tool call times out, that does NOT mean it failed — the server may still be starting in the background. Check `get_notebook_status` before retrying.

## Working with Notebooks via MCP

These rules are critical when interacting with Pluto notebooks through the MCP API:

### File Ownership

- **Never edit the `.pluto.jl` file on disk while the notebook is open** — Pluto owns that file. Changes made outside the MCP API will be ignored or overwritten.
- All cell mutations (create, edit, delete) must go through the MCP tools.
- To persist changes to disk, call `save_notebook` explicitly. **Notebooks are NOT auto-saved.**
- **If a change (folding, reordering, etc.) does not appear to have persisted on disk, do not attempt to fix it yourself.** Just inform the user — Pluto manages file writes and the issue may be on the server side.

### Handling Timeouts

- If `create_cell` times out, the cell was likely still created in Pluto. Use `list_cells` to check before retrying — creating the same cell twice causes "Multiple definitions" errors.
- For slow operations (e.g. `import Pkg; Pkg.add(...)`), prefer: (1) `edit_cell` with `run=false` to set the code, then (2) `execute_cell` to run it. This avoids timeout-induced phantom cells.
- Use `delete_cell` to remove any accidental duplicate cells.

### Pluto Reactivity Rules

- **Each variable can only be defined in one cell.** If you get a "Multiple definitions" error, use `list_cells` to find the duplicate, then `delete_cell` to remove it.
- When you edit a cell, Pluto automatically re-runs all cells that depend on the changed variables.
- **Just `using PackageName`** — Pluto's built-in package manager will automatically install and track the package. Only fall back to a manual `import Pkg; Pkg.activate(; temp=true); Pkg.add([...])` cell if the plain `using` approach fails.

### Cell Visibility

- **Fold cells that are markdown-only or plot-only** using `fold_cell` — this hides the source code in Pluto's UI while still showing the rendered output. It keeps the notebook clean for readers.
- Use `list_cells` to check the current `code_folded` state of each cell.

### Recommended Workflow

1. `open_notebook` (file must exist on disk first)
2. `list_cells` to see current state
3. `create_cell` / `edit_cell` / `delete_cell` to make changes
4. `fold_cell` to hide code for markdown/plot cells
5. `read_cell` to inspect outputs
6. `save_notebook` to persist to disk when done
7. `get_notebook_url` to give the user a browser link

## Table of Contents

- [Notebook Structure](#notebook-structure)
- [Cell Rules and Reactivity](#cell-rules-and-reactivity)
- [Markdown Cells](#markdown-cells)
- [PlutoUI Components](#plutoui-components)
- [Combining Markdown and PlutoUI](#combining-markdown-and-plutoui)
- [Best Practices](#best-practices)
- [Beautifying a Notebook](#beautifying-a-notebook)
- [Common Patterns](#common-patterns)

---

## Notebook Structure

### File Format

A Pluto notebook is a Julia file (`.jl`) with a specific structure:

```julia
### A Pluto.jl notebook ###
# v0.20.19

using Markdown
using InteractiveUtils

# ╔═╡ cell-uuid-1
# ╠═╡ disabled = false
# ╠═╡ show_logs = true
# ╠═╡ skip_as_script = false
md"""
# Your content here
"""

# ╔═╡ cell-uuid-2
x = 10

# ╔═╡ Cell order:
# ╠═cell-uuid-1
# ╠═cell-uuid-2
```

### Cell Markers

Each cell starts with a unique identifier:

- `# ╔═╡ <uuid>` - Cell boundary marker
- Cell UUIDs are automatically generated
- Cells contain Julia code, markdown, or expressions

### Cell Metadata

Cells can have metadata comments:

- `# ╠═╡ disabled = false` - Cell execution state
- `# ╠═╡ show_logs = true` - Show cell output logs
- `# ╠═╡ skip_as_script = false` - Include cell when exporting as script

### Cell Order Section

At the end of the notebook:

```julia
# ╔═╡ Cell order:
# ╠═cell-uuid-1
# ╠═cell-uuid-2
# ╠═cell-uuid-3
```

This defines the display order of cells (not execution order).

---

## Cell Rules and Reactivity

### Reactive Execution Model

**Key Principle**: Pluto automatically determines execution order based on variable dependencies.

#### Rules

1. **One Variable per Cell (Assignment)**

   ```julia
   # ✅ CORRECT
   x = 10

   # ❌ WRONG - Cannot assign same variable in another cell
   x = 20  # Error: Multiple definitions of x
   ```

2. **Use `begin...end` for Multiple Statements**

   ```julia
   # ✅ CORRECT
   begin
       x = 10
       y = 20
       z = x + y
   end
   ```

3. **Automatic Dependency Tracking**

   ```julia
   # Cell 1
   a = 5

   # Cell 2 (depends on Cell 1)
   b = a * 2  # Automatically re-runs when 'a' changes

   # Cell 3 (depends on Cell 2)
   c = b + 10  # Automatically re-runs when 'b' changes
   ```

4. **No Hidden State**
   - Every variable is defined exactly once
   - Execution order is determined by dependencies, not cell order
   - Deleting a cell removes its variables completely

5. **Import/Package Management**

   Pluto has a built-in package manager — just `using` the package you need:

   ```julia
   using Plots
   ```

   ```julia
   using DataFrames
   ```

   Pluto will automatically install and track the package. Only fall back to the manual approach if the above fails:

   ```julia
   begin
       import Pkg
       Pkg.activate(; temp=true)
       Pkg.add(["Plots", "DataFrames"])
   end
   ```

---

## Markdown Cells

### Basic Markdown Syntax

Markdown cells use triple-quote syntax:

```julia
md"""
# Heading 1
## Heading 2
### Heading 3

**Bold text**
*Italic text*

- Bullet point 1
- Bullet point 2

1. Numbered item 1
2. Numbered item 2

[Link text](https://example.com)
"""
```

### LaTeX Math

```julia
md"""
Inline math: $E = mc^2$

Display math:
$$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$
"""
```

### Interpolating Variables

Use `$()` to embed Julia expressions:

```julia
x = 42

md"""
The value of x is $(x).

Computed value: $(x * 2)
"""
```

### Tables in Markdown

```julia
md"""
| Column 1 | Column 2 | Column 3 |
| -------- | -------- | -------- |
| Value A  | Value B  | Value C  |
| Value D  | Value E  | Value F  |
"""
```

---

## PlutoUI Components

PlutoUI provides interactive widgets using the `@bind` macro. **If the user asks for interactivity** (sliders, dropdowns, toggles, user input, etc.), suggest using PlutoUI — it is the standard way to add interactive controls to Pluto notebooks.

### Installation

```julia
using PlutoUI
```

Pluto's built-in package manager will install it automatically.

### @bind Macro

The `@bind` macro connects a UI element to a variable:

```julia
@bind variable_name Widget(options...)
```

### Available Components

#### 1. Slider

Creates a slider for numeric input.

```julia
# Basic slider
@bind x Slider(1:100)

# Slider with default value and display
@bind temperature Slider(0:0.1:100, default=25, show_value=true)

# Slider with custom range
@bind alpha Slider(0.0:0.01:1.0, default=0.5)
```

**Parameters:**

- `range` - Range of values (e.g., `1:10` or `0.0:0.1:1.0`)
- `default` - Initial value
- `show_value` - Display current value (true/false)

#### 2. TextField

Text input field.

```julia
# Single-line text field
@bind name TextField()

# Text field with default value
@bind description TextField(default="Enter description")

# Multi-line textarea
@bind notes TextField((50, 10))  # (cols, rows)
```

**Parameters:**

- `default` - Initial text value
- `dims=(cols, rows)` - For multi-line textarea

#### 3. NumberField

Numeric input field.

```julia
# Number field with range
@bind count NumberField(1:100, default=10)

# Float number field
@bind value NumberField(0.0:0.1:10.0, default=5.0)
```

**Parameters:**

- `range` - Valid number range
- `default` - Initial value

#### 4. CheckBox

Boolean checkbox.

```julia
# Simple checkbox
@bind enabled CheckBox()

# Checkbox with default value
@bind show_details CheckBox(default=true)
```

**Parameters:**

- `default` - Initial state (true/false)

#### 5. Select

Dropdown selection.

```julia
# Select from array
@bind color Select(["red", "green", "blue"])

# Select with default
@bind option Select(["Option A", "Option B", "Option C"], default="Option B")

# Select from pairs (value => label)
@bind choice Select([1 => "First", 2 => "Second", 3 => "Third"])
```

**Parameters:**

- `options` - Array of options or pairs
- `default` - Initially selected value

#### 6. MultiSelect

Multiple selection dropdown.

```julia
# Multi-select
@bind colors MultiSelect(["red", "green", "blue", "yellow"])

# Multi-select with defaults
@bind selected MultiSelect(
    ["A", "B", "C", "D"],
    default=["A", "C"]
)
```

#### 7. Button

Clickable button.

```julia
# Simple button
@bind clicked Button("Click me!")

# Button that increments on each click
@bind click_count Button("Increment")
```

**Note**: Button sends the same value each time clicked, triggering reactive cells.

#### 8. Radio

Radio button group (single selection).

```julia
@bind choice Radio(["Option 1", "Option 2", "Option 3"])

@bind size Radio(["Small", "Medium", "Large"], default="Medium")
```

#### 9. FilePicker

File upload widget.

```julia
@bind uploaded_file FilePicker()

# Access file content
file_data = uploaded_file["data"]
file_name = uploaded_file["name"]
```

#### 10. Clock

Timer that ticks at regular intervals.

```julia
# Tick every second
@bind tick Clock()

# Tick every 0.5 seconds
@bind tick Clock(0.5)
```

#### 11. DateField

Date picker.

```julia
@bind selected_date DateField()

@bind start_date DateField(default=Dates.today())
```

---

## Combining Markdown and PlutoUI

### Inline Widgets in Tables

You can embed PlutoUI widgets directly in markdown tables:

```julia
md"""
| Parameter | Description | Units | Value |
| --------- | ----------- | ----- | ----- |
| `T_inf` | Ambient temperature | K | $(@bind T_inf NumberField(0:500, default=300)) |
| `h` | Heat transfer coefficient | W/(m²·K) | $(@bind h Slider(0.0:0.1:1.0, default=0.7)) |
| `mass` | Mass | kg | $(@bind m NumberField(0.0:0.1:10.0, default=1.0)) |
"""
```

### Using Widget Values in Markdown

```julia
@bind speed Slider(1:100, default=50, show_value=true)

md"""
## Speed Control

Current speed: $(speed) km/h

Status: $(speed > 80 ? "🔴 Fast" : "🟢 Normal")
"""
```

### Embedded Plots and Computations

```julia
md"""
# Wave Parameters

| Parameter | Value |
| --------- | ----- |
| Amplitude | $(@bind amplitude Slider(0.1:0.1:5.0, default=1.0, show_value=true)) |
| Frequency | $(@bind frequency Slider(0.1:0.1:10.0, default=1.0, show_value=true)) |

## Waveform

$(begin
    x = 0:0.01:2π
    y = amplitude .* sin.(frequency .* x)
    plot(x, y, label="sin wave", xlabel="x", ylabel="y")
end)
"""
```

### Dynamic Content Generation

```julia
begin
    @bind param1 NumberField(0:100, default=50)
    @bind param2 Slider(0.0:0.1:1.0, default=0.5)

    result = param1 * param2

    md"""
    # Interactive Calculator

    | Input | Value |
    | ----- | ----- |
    | Parameter 1 | $(param1) |
    | Parameter 2 | $(param2) |
    | **Result** | **$(result)** |

    The computation shows: $(param1) × $(param2) = $(result)
    """
end
```

---

## Best Practices

### 1. Package Management

Just `using` the packages you need — Pluto will install them automatically:

```julia
using Plots
```

```julia
using DataFrames
```

Each `using` should be in its own cell. Only use the manual `Pkg.activate(; temp=true)` + `Pkg.add(...)` approach as a fallback if automatic installation fails.

### 2. Organize with Markdown Headers

```julia
md"""
# Section 1: Data Loading

Load and prepare the data.
"""

# ... code cells ...

md"""
# Section 2: Analysis

Perform the analysis.
"""

# ... code cells ...
```

### 3. Use `begin...end` for Complex Logic

```julia
begin
    # Multiple related computations
    data = load_data()
    cleaned = clean_data(data)
    result = analyze(cleaned)
    result
end
```

### 4. Display the Last Expression

The last expression in a cell is automatically displayed:

```julia
begin
    x = 10
    y = 20
    x + y  # This value is displayed
end
```

### 5. Suppress Output with Semicolon

```julia
# Suppress display
large_data = load_large_dataset();

# Show specific output
println("Data loaded successfully")
```

### 6. Use @doc for Documentation

```julia
md"""
## Function Documentation

$(@doc my_function)
"""
```

### 7. Bind Multiple Related Widgets

```julia
md"""
## Configuration

| Parameter | Value |
| --------- | ----- |
| X | $(@bind x Slider(1:10, default=5)) |
| Y | $(@bind y Slider(1:10, default=5)) |

Sum: $(x + y)
Product: $(x * y)
"""
```

---

## Beautifying a Notebook

When a notebook is functionally complete, polish it for readability. Use `move_cells`, `fold_cell`, and markdown cells to turn working code into a presentable document.

### Notebook Structure

Aim for this top-to-bottom layout:

1. **Title and introduction** — a markdown cell with the notebook title, author, and purpose
2. **Table of Contents** — a markdown cell with `TableOfContents()` from PlutoUI
3. **Key results and summary** — the main outputs, plots, or conclusions the reader cares about
4. **Analysis sections** — the substantive work, organized under markdown headers
5. **Boilerplate at the bottom** — helper functions, constants, and configuration cells
6. **`Pkg` cells at the very end** — any manual `Pkg.activate` / `Pkg.add` cells should be the last cells in the notebook

Use `move_cells` to reorder cells into this layout.

### Table of Contents

Add a `TableOfContents` cell near the top (requires PlutoUI):

```julia
TableOfContents()
```

This renders a sticky sidebar that links to all `#`, `##`, `###` headings in your markdown cells.

### Folding Cells

Use `fold_cell` to hide source code while keeping the rendered output visible:

Folding hides the **source code**, not the output — the rendered result is always visible.

- **Always fold**: markdown cells (`md"""`, `@mdx`), `@bind` widget cells, plot-only cells, `TableOfContents()` cells
- **Usually fold**: helper function definitions, data loading, configuration
- **Don't fold**: cells where the source code itself is meant to be read (tutorials, examples, key algorithms)

### Section Headers

Break the notebook into logical sections with markdown headers:

```julia
md"""
# 1. Data Loading
"""
```

```julia
md"""
# 2. Analysis
"""
```

```julia
md"""
# 3. Results
"""
```

Fold these header cells so only the rendered heading shows.

### Fine-Tuning Text

- Use **bold** for key terms and results: `**accuracy: 94.2%**`
- Use inline code for variable names and function references: `` `my_function` ``
- Add context to plots with a markdown cell above or below explaining what the reader should notice
- Use admonitions for important notes:

```julia
md"""
!!! tip "Performance"
    This computation runs in O(n log n) time.
"""
```

### HTML in Markdown

If you need raw HTML in markdown cells (custom styling, embedded iframes, etc.), use `MarkdownLiteral`:

```julia
using MarkdownLiteral: @mdx
```

Then use `@mdx` instead of `md`:

```julia
@mdx """
<div style="background: #f0f0f0; padding: 1em; border-radius: 8px;">
  <h3>Custom styled block</h3>
  <p>This supports full HTML.</p>
</div>
"""
```

**Note:** You cannot combine `:` imports with comma-separated `using` — each must be its own cell:

```julia
# ✅ CORRECT — separate cells
using PlutoUI
```

```julia
using MarkdownLiteral: @mdx
```

```julia
# ❌ WRONG — syntax error
using PlutoUI, MarkdownLiteral: @mdx
```

### Checklist

After finishing the notebook content, run through these steps:

1. Add a title cell at the very top
2. Add `TableOfContents()` right after the title
3. Move results/summary cells near the top, below the TOC
4. Move boilerplate (imports, helpers, constants) to the bottom
5. Move any `Pkg` cells to the very end
6. Fold all markdown cells, plot cells, TOC, and boilerplate
7. Ensure each section has a markdown header
8. **Run `list_cells` and check for errors** — verify no cells are in an errored state. If something crashed, fix it before saving. A beautified notebook that doesn't run is worse than an ugly one that does.
9. `save_notebook` to persist the final layout

---

## Common Patterns

### Pattern 1: Interactive Parameter Sweep

```julia
# Define parameters with widgets
@bind param Slider(1:100, default=50, show_value=true)

# Compute based on parameter
result = expensive_computation(param)

# Display results
plot(result)
```

### Pattern 2: Conditional Display

```julia
@bind show_advanced CheckBox(default=false)
```

```julia

md"""
Show advanced options: $(show_advanced ? "✅ Enabled" : "❌ Disabled")

$(if show_advanced
    md"## Advanced Settings

    Configure advanced parameters here."
else
    md""
end)
"""
```

### Pattern 3: Multi-Step Workflow

```julia
md"""
# Step 1: Select Dataset
$(@bind dataset Select(["Dataset A", "Dataset B", "Dataset C"]))
"""

# Load selected dataset
data = load_dataset(dataset)

md"""
# Step 2: Configure Analysis
$(@bind threshold Slider(0:0.1:1, default=0.5, show_value=true))
"""

# Perform analysis
results = analyze(data, threshold)

md"""
# Step 3: Results

$(plot(results))
"""
```

### Pattern 4: Table with Embedded Widgets

```julia
md"""
# Parameter Configuration

| Parameter | Description | Units | Value |
| --------- | ----------- | ----- | ----- |
| `temperature` | Operating temperature | °C | $(@bind temp NumberField(0:200, default=25)) |
| `pressure` | Operating pressure | bar | $(@bind pres NumberField(0:100, default=1)) |
| `enabled` | Enable feature | - | $(@bind enabled CheckBox(default=true)) |
"""
```

```julia
# Use the bound values
config = (temperature=temp, pressure=pres, enabled=enabled)
```

### Pattern 5: Real-time Visualization

```julia
@bind time Clock(0.1)  # Update every 0.1 seconds

begin
    # Generate time-varying data
    t = time
    x = 0:0.1:2π
    y = sin.(x .+ t)

    plot(x, y, label="sin(x + t)", ylims=(-1.5, 1.5))
end
```

### Pattern 6: Form-like Interface

```julia
md"""
# User Profile

| Field | Input |
| ----- | ----- |
| Name | $(@bind user_name TextField(default="")) |
| Age | $(@bind user_age NumberField(1:120, default=25)) |
| Country | $(@bind country Select(["USA", "UK", "Canada", "Other"])) |
| Subscribe | $(@bind subscribe CheckBox(default=false)) |

$(@bind submit_button Button("Submit"))
"""
```

```julia
begin
    profile = (
        name = user_name,
        age = user_age,
        country = country,
        subscribe = subscribe
    )

    md"""
    ## Submitted Profile

    - **Name**: $(profile.name)
    - **Age**: $(profile.age)
    - **Country**: $(profile.country)
    - **Newsletter**: $(profile.subscribe ? "✅ Yes" : "❌ No")
    """
end
```

---

## Summary

### Key Takeaways

1. **Reactivity**: Cells automatically re-run based on dependencies
2. **One Variable Rule**: Each variable can only be defined once across all cells
3. **`@bind` Macro**: Connects UI widgets to variables
4. **Markdown Integration**: Use `$()` to embed Julia expressions in markdown
5. **Tables + Widgets**: Combine markdown tables with PlutoUI for interactive forms
6. **No Hidden State**: All variables are explicit and traceable

### Quick Reference

**Slider**: `@bind x Slider(1:100, default=50, show_value=true)`

**TextField**: `@bind text TextField(default="")`

**NumberField**: `@bind n NumberField(0:100, default=10)`

**CheckBox**: `@bind checked CheckBox(default=false)`

**Select**: `@bind choice Select(["A", "B", "C"])`

**Button**: `@bind clicked Button("Click")`

**Markdown + Widget**: `$(@bind x Slider(1:10))`

**Markdown + Variable**: `The value is $(x)`

---

## Additional Resources

- Official Pluto.jl: <https://plutojl.org/>
- PlutoUI Documentation: <https://github.com/JuliaPluto/PlutoUI.jl>
- Featured Examples: <https://featured.plutojl.org/>

---

**Note for AI Tools**: When creating or modifying Pluto notebooks:

- Always respect the one-variable-per-cell rule
- Use `begin...end` blocks for multiple statements
- Ensure cell UUIDs are unique
- Maintain the cell order section at the end
- Use `@bind` for all interactive widgets
- Test reactivity by changing dependent variables
