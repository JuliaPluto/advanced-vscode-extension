# Pluto.jl Notebook Guide for AI Tools

This guide explains how to work with Pluto.jl notebooks, including cell structure, reactivity rules, PlutoUI components, and best practices.

## Important: Server Startup Times

Starting a Pluto server involves installing Julia packages and precompiling them. **The first run can take several minutes** (2-10 minutes depending on the system). If `start_pluto_server` or `open_notebook` appears to hang or times out:

1. **Do not retry immediately** — the server is likely still starting up.
2. **Wait 30-60 seconds**, then call `get_notebook_status` to check progress.
3. **Subsequent runs are much faster** since packages are cached.

If a tool call times out, that does NOT mean it failed — the server may still be starting in the background. Check `get_notebook_status` before retrying.

## Table of Contents

- [Notebook Structure](#notebook-structure)
- [Cell Rules and Reactivity](#cell-rules-and-reactivity)
- [Markdown Cells](#markdown-cells)
- [PlutoUI Components](#plutoui-components)
- [Combining Markdown and PlutoUI](#combining-markdown-and-plutoui)
- [Best Practices](#best-practices)
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

   ```julia
   begin
       import Pkg
       Pkg.activate(; temp=true)
       Pkg.add(["Plots", "DataFrames", "PlutoUI"])
       using Plots
       using PlutoUI
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

PlutoUI provides interactive widgets using the `@bind` macro.

### Installation

```julia
begin
    import Pkg
    Pkg.add("PlutoUI")
    using PlutoUI
end
```

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

Always use a cell at the beginning for package management:

```julia
begin
    import Pkg
    Pkg.activate(; temp=true)
    Pkg.add(["Plots", "DataFrames", "PlutoUI"])
    using Plots
    using DataFrames
    using PlutoUI
end
```

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
