### A Pluto.jl notebook ###
# v0.19.40

using Markdown
using InteractiveUtils

# This cell contains imports that will be used throughout the notebook

# ╔═╡ 8e6f3a40-9e3a-4fee-8f5e-0fb8c1c8e8e8
#VSCODE-MARKDOWN
md"""
# Pluto Notebook Demo
This is an example Pluto notebook demonstrating various features.
"""

# ╔═╡ a1b2c3d4-9e3a-41ee-9234-0fb8c1c8e8e8
# Basic Julia computation
x = 5

# ╔═╡ b2c3d4e5-9e3a-41ee-a345-0fb8c1c8e8e8
y = x^2 + 2x - 1

# ╔═╡ c3d4e5f6-9e3a-41ee-b456-0fb8c1c8e8e8
md"""
The value of y is **$(y)**
"""

# ╔═╡ d4e5f6a7-9e3a-41ee-8567-0fb8c1c8e8e8
# Array operations
data = [1, 2, 3, 4, 5]

# ╔═╡ e5f6a7b8-9e3a-41ee-9678-0fb8c1c8e8e8
squared_data = data .^ 2

# ╔═╡ f6a7b8c9-9e3a-41ee-a789-0fb8c1c8e8e8
sum_squared = sum(squared_data)

# ╔═╡ a7b8c9d0-9e3a-41ee-b890-0fb8c1c8e8e8
#VSCODE-MARKDOWN
md"""
## Interactive Widgets
Pluto supports interactive widgets using `@bind`
"""

# ╔═╡ b8c9d0e1-9e3a-41ee-8901-0fb8c1c8e8e8
begin
    import Pkg
    Pkg.add("PlutoUI")
end

# ╔═╡ c9d0e1f2-9e3a-41ee-9012-0fb8c1c8e8e8
using PlutoUI

# ╔═╡ d0e1f2a3-9e3a-41ee-8123-0fb8c1c8e8e8
@bind n Slider(1:100, default=10, show_value=true)

# ╔═╡ e1f2a3b4-9e3a-41ee-9234-0fb8c1c8e8e8
md"""
You selected: **$(n)**
"""

# ╔═╡ f2a3b4c5-9e3a-41ee-a345-0fb8c1c8e8e8
# Reactive computation based on slider
fibonacci_n = let
    a, b = 0, 1
    for i in 1:n
        a, b = b, a + b
    end
    a
end

# ╔═╡ a3b4c5d6-9e3a-41ee-b456-0fb8c1c8e8e8
md"""
The $(n)th Fibonacci number is: **$(fibonacci_n)**
"""

# ╔═╡ b4c5d6e7-9e3a-41ee-8567-0fb8c1c8e8e8
md"""
## Text Input Widget
"""

# ╔═╡ c5d6e7f8-9e3a-41ee-9678-0fb8c1c8e8e8
@bind name TextField(default="World")

# ╔═╡ d6e7f8a9-9e3a-41ee-a789-0fb8c1c8e8e8
md"""
Hello, **$(name)**! 👋
"""

# ╔═╡ e7f8a9b0-9e3a-41ee-b890-0fb8c1c8e8e8
md"""
## Plotting
Let's create some visualizations using Plots.jl
"""

# ╔═╡ f8a9b0c1-9e3a-41ee-8901-0fb8c1c8e8e8
begin
    Pkg.add("Plots")
end

# ╔═╡ a9b0c1d2-9e3a-41ee-9012-0fb8c1c8e8e8
using Plots

# ╔═╡ b0c1d2e3-9e3a-41ee-8123-0fb8c1c8e8e8
# Simple line plot
plot(1:10, (1:10) .^ 2,
    label="y = x²",
    xlabel="x",
    ylabel="y",
    title="Quadratic Function",
    linewidth=2,
    color=:blue,
    legend=:topleft)

# ╔═╡ c1d2e3f4-9e3a-41ee-9234-0fb8c1c8e8e8
# Multiple functions on same plot
let
    x_range = -2π:0.1:2π
    plot(x_range, sin.(x_range), label="sin(x)", linewidth=2)
    plot!(x_range, cos.(x_range), label="cos(x)", linewidth=2)
    plot!(x_range, sin.(x_range) .* cos.(x_range), label="sin(x)·cos(x)", linewidth=2)
    xlabel!("x")
    ylabel!("y")
    title!("Trigonometric Functions")
end

# ╔═╡ d2e3f4a5-9e3a-41ee-a345-0fb8c1c8e8e8
# Scatter plot
scatter(randn(100), randn(100),
    alpha=0.5,
    markersize=8,
    color=:purple,
    xlabel="X",
    ylabel="Y",
    title="Random Scatter Plot",
    legend=false)

# ╔═╡ e3f4a5b6-9e3a-41ee-b456-0fb8c1c8e8e8
md"""
## Interactive Plot
Control the plot parameters with widgets!
"""

# ╔═╡ f4a5b6c7-9e3a-41ee-8567-0fb8c1c8e8e8
@bind amplitude Slider(0.5:0.1:3.0, default=1.0, show_value=true)

# ╔═╡ a5b6c7d8-9e3a-41ee-9678-0fb8c1c8e8e8
@bind frequency Slider(1:10, default=2, show_value=true)

# ╔═╡ b6c7d8e9-9e3a-41ee-a789-0fb8c1c8e8e8
md"""
- Amplitude: $(amplitude)
- Frequency: $(frequency)
"""

# ╔═╡ c7d8e9f0-9e3a-41ee-b890-0fb8c1c8e8e8
# Interactive sine wave
let
    x = 0:0.01:4π
    y = amplitude .* sin.(frequency .* x)
    plot(x, y,
        linewidth=3,
        color=:red,
        xlabel="x",
        ylabel="y",
        title="Interactive Sine Wave: y = $(amplitude) · sin($(frequency)x)",
        legend=false,
        ylim=(-3.5, 3.5))
end

# ╔═╡ d8e9f0a1-9e3a-41ee-8901-0fb8c1c8e8e8
md"""
## Heatmap Example
"""

# ╔═╡ e9f0a1b2-9e3a-41ee-9012-0fb8c1c8e8e8
# Generate data for heatmap
heatmap_data = [sin(x) * cos(y) for x in range(0, 2π, length=50), y in range(0, 2π, length=50)]

# ╔═╡ f0a1b2c3-9e3a-41ee-8123-0fb8c1c8e8e8
heatmap(heatmap_data,
    color=:viridis,
    xlabel="X",
    ylabel="Y",
    title="sin(x) · cos(y) Heatmap",
    aspect_ratio=:equal)

# ╔═╡ a1b2c3d4-9e3a-41ee-9234-5fb8c1c8e8e9
md"""
## Mathematical Expressions
Pluto supports LaTeX math rendering:

$e^{i\pi} + 1 = 0$

The quadratic formula:
$x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$
"""

# ╔═╡ b2c3d4e5-9e3a-41ee-a345-5fb8c1c8e8e9
md"""
## Data Structures
"""

# ╔═╡ c3d4e5f6-9e3a-41ee-b456-5fb8c1c8e8e9
# Dictionary
person = Dict(
    "name" => "Alice",
    "age" => 30,
    "city" => "New York"
)

# ╔═╡ d4e5f6a7-9e3a-41ee-8567-5fb8c1c8e8e9
# Named tuple
point = (x=10, y=20, z=30)

# ╔═╡ e5f6a7b8-9e3a-41ee-9678-5fb8c1c8e8e9
md"""
Person: $(person["name"]), Age: $(person["age"])

Point coordinates: ($(point.x), $(point.y), $(point.z))
"""

# ╔═╡ f6a7b8c9-9e3a-41ee-a789-5fb8c1c8e8e9
md"""
## Functions
"""

# ╔═╡ a7b8c9d0-9e3a-41ee-b890-5fb8c1c8e8e9
function greet(name, greeting="Hello")
    return "$greeting, $name!"
end

# ╔═╡ b8c9d0e1-9e3a-41ee-8901-5fb8c1c8e8e9
greet("Julia")

# ╔═╡ c9d0e1f2-9e3a-41ee-9012-5fb8c1c8e8e9
greet("Pluto", "Welcome")

# ╔═╡ d0e1f2a3-9e3a-41ee-8123-5fb8c1c8e8e0
md"""
## Reactive Programming
One of Pluto's superpowers is reactive programming - when you change a variable, all cells that depend on it automatically re-run!
"""

# ╔═╡ 00000000-0000-0000-0000-000000000001
PLUTO_PROJECT_TOML_CONTENTS = """
[deps]
Plots = "91a5bcdd-55d7-5caf-9e0b-520d859cae80"
PlutoUI = "7f904dfe-b85e-4ff6-b463-dae2292396a8"

[compat]
Plots = "~1.39.0"
PlutoUI = "~0.7.54"
"""

# ╔═╡ 00000000-0000-0000-0000-000000000002
PLUTO_MANIFEST_TOML_CONTENTS = """
# This file is machine-generated - editing it directly is not advised

julia_version = "1.10.0"
manifest_format = "2.0"
project_hash = "abcd1234"

[[deps.Plots]]
deps = ["Base64", "Contour", "Dates", "Downloads", "FFMPEG", "FixedPointNumbers", "GR", "JLFzf", "JSON", "LaTeXStrings", "Latexify", "LinearAlgebra", "Measures", "NaNMath", "Pkg", "PlotThemes", "PlotUtils", "PrecompileTools", "Preferences", "Printf", "REPL", "Random", "RecipesBase", "RecipesPipeline", "Reexport", "RelocatableFolders", "Requires", "Scratch", "Showoff", "SparseArrays", "Statistics", "StatsBase", "UUIDs", "UnicodeFun", "UnitfulLatexify", "Unzip"]
git-tree-sha1 = "ccee59c6e48e6f2edf8a5b64dc817b6729f99eb5"
uuid = "91a5bcdd-55d7-5caf-9e0b-520d859cae80"
version = "1.39.0"

[[deps.PlutoUI]]
deps = ["AbstractPlutoDingetjes", "Base64", "ColorTypes", "Dates", "FixedPointNumbers", "Hyperscript", "HypertextLiteral", "IOCapture", "InteractiveUtils", "JSON", "Logging", "MIMEs", "Markdown", "Random", "Reexport", "URIs", "UUIDs"]
git-tree-sha1 = "bd7c69c7f7173097e7b5e1be07cee2b8b7447f51"
uuid = "7f904dfe-b85e-4ff6-b463-dae2292396a8"
version = "0.7.54"
"""

# ╔═╡ Cell order:
# ╟─8e6f3a40-9e3a-4fee-8f5e-0fb8c1c8e8e8
# ╠═a1b2c3d4-9e3a-41ee-9234-0fb8c1c8e8e8
# ╠═b2c3d4e5-9e3a-41ee-a345-0fb8c1c8e8e8
# ╟─c3d4e5f6-9e3a-41ee-b456-0fb8c1c8e8e8
# ╠═d4e5f6a7-9e3a-41ee-8567-0fb8c1c8e8e8
# ╠═e5f6a7b8-9e3a-41ee-9678-0fb8c1c8e8e8
# ╠═f6a7b8c9-9e3a-41ee-a789-0fb8c1c8e8e8
# ╟─a7b8c9d0-9e3a-41ee-b890-0fb8c1c8e8e8
# ╠═b8c9d0e1-9e3a-41ee-8901-0fb8c1c8e8e8
# ╠═c9d0e1f2-9e3a-41ee-9012-0fb8c1c8e8e8
# ╟─d0e1f2a3-9e3a-41ee-8123-0fb8c1c8e8e8
# ╟─e1f2a3b4-9e3a-41ee-9234-0fb8c1c8e8e8
# ╠═f2a3b4c5-9e3a-41ee-a345-0fb8c1c8e8e8
# ╟─a3b4c5d6-9e3a-41ee-b456-0fb8c1c8e8e8
# ╟─b4c5d6e7-9e3a-41ee-8567-0fb8c1c8e8e8
# ╟─c5d6e7f8-9e3a-41ee-9678-0fb8c1c8e8e8
# ╟─d6e7f8a9-9e3a-41ee-a789-0fb8c1c8e8e8
# ╟─e7f8a9b0-9e3a-41ee-b890-0fb8c1c8e8e8
# ╠═f8a9b0c1-9e3a-41ee-8901-0fb8c1c8e8e8
# ╠═a9b0c1d2-9e3a-41ee-9012-0fb8c1c8e8e8
# ╠═b0c1d2e3-9e3a-41ee-8123-0fb8c1c8e8e8
# ╠═c1d2e3f4-9e3a-41ee-9234-0fb8c1c8e8e8
# ╠═d2e3f4a5-9e3a-41ee-a345-0fb8c1c8e8e8
# ╟─e3f4a5b6-9e3a-41ee-b456-0fb8c1c8e8e8
# ╟─f4a5b6c7-9e3a-41ee-8567-0fb8c1c8e8e8
# ╟─a5b6c7d8-9e3a-41ee-9678-0fb8c1c8e8e8
# ╟─b6c7d8e9-9e3a-41ee-a789-0fb8c1c8e8e8
# ╠═c7d8e9f0-9e3a-41ee-b890-0fb8c1c8e8e8
# ╟─d8e9f0a1-9e3a-41ee-8901-0fb8c1c8e8e8
# ╠═e9f0a1b2-9e3a-41ee-9012-0fb8c1c8e8e8
# ╠═f0a1b2c3-9e3a-41ee-8123-0fb8c1c8e8e8
# ╟─a1b2c3d4-9e3a-41ee-9234-5fb8c1c8e8e9
# ╟─b2c3d4e5-9e3a-41ee-a345-5fb8c1c8e8e9
# ╠═c3d4e5f6-9e3a-41ee-b456-5fb8c1c8e8e9
# ╠═d4e5f6a7-9e3a-41ee-8567-5fb8c1c8e8e9
# ╟─e5f6a7b8-9e3a-41ee-9678-5fb8c1c8e8e9
# ╟─f6a7b8c9-9e3a-41ee-a789-5fb8c1c8e8e9
# ╠═a7b8c9d0-9e3a-41ee-b890-5fb8c1c8e8e9
# ╠═b8c9d0e1-9e3a-41ee-8901-5fb8c1c8e8e9
# ╠═c9d0e1f2-9e3a-41ee-9012-5fb8c1c8e8e9
# ╟─d0e1f2a3-9e3a-41ee-8123-5fb8c1c8e8e0
# ╟─00000000-0000-0000-0000-000000000001
# ╟─00000000-0000-0000-0000-000000000002
