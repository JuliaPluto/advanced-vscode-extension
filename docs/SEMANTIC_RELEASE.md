# Semantic Release Guide

This project uses [semantic-release](https://github.com/semantic-release/semantic-release) to automate version management and package publishing.

## How It Works

semantic-release automates the entire release workflow:

1. **Analyzes commits** - Determines version bump based on conventional commits
2. **Generates changelog** - Creates CHANGELOG.md from commit messages
3. **Updates version** - Bumps version in package.json
4. **Creates release** - Tags the release and creates GitHub release
5. **Publishes VSIX** - Packages and attaches VSIX file to release
6. **Commits changes** - Commits package.json and CHANGELOG.md back to repo

## Release Workflow

### Automatic Releases

Releases happen automatically when you push to `main` branch:

```bash
git push origin main
```

The CI workflow will:

1. Run validation, linting, and tests
2. Build the extension
3. Run semantic-release to create the release

**No manual version bumping or tagging needed!**

## Commit Message Format

This project uses [Conventional Commits](https://www.conventionalcommits.org/) format. See [CONTRIBUTING.md](./CONTRIBUTING.md#commit-message-format) for detailed commit message guidelines.

### Version Bumping Rules

| Commit Type                 | Version Bump  | Example                    |
| --------------------------- | ------------- | -------------------------- |
| `fix:`                      | Patch (0.0.x) | `fix: handle empty cells`  |
| `feat:`                     | Minor (0.x.0) | `feat: add cell execution` |
| `BREAKING CHANGE:` or `!`   | Major (x.0.0) | `feat!: remove old API`    |
| `docs:`, `style:`, `chore:` | No release    | -                          |

### Examples

**Patch Release (0.0.x):**

```bash
git commit -m "fix: resolve cell rendering issue"
```

**Minor Release (0.x.0):**

```bash
git commit -m "feat: add markdown cell support"
```

**Major Release (x.0.0):**

```bash
git commit -m "feat!: redesign notebook API

BREAKING CHANGE: The notebook API has been completely redesigned."
```

**No Release:**

```bash
git commit -m "docs: update README"
git commit -m "chore: update dependencies"
```

## What Gets Generated

When semantic-release runs, it creates:

1. **Git tag** - e.g., `v1.2.3`
2. **GitHub release** - With auto-generated release notes
3. **CHANGELOG.md** - Updated with new version section
4. **VSIX file** - Attached to GitHub release
5. **Commit** - Updates package.json and CHANGELOG.md

## Configuration

The configuration is in `.releaserc.json`:

```json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer", // Analyzes commits
    "@semantic-release/release-notes-generator", // Generates notes
    "@semantic-release/changelog", // Updates CHANGELOG.md
    ["@semantic-release/npm", { "npmPublish": false }], // No npm publish
    ["semantic-release-vsce", { "packageVsix": true }], // Create VSIX
    ["@semantic-release/github", { "assets": ["*.vsix"] }], // Upload VSIX
    ["@semantic-release/git", { "assets": ["package.json", "CHANGELOG.md"] }] // Commit back
  ]
}
```

## Publishing to VS Code Marketplace (Optional)

To automatically publish to the VS Code Marketplace:

1. Create a Personal Access Token from [Azure DevOps](https://dev.azure.com/)
2. Add it as a repository secret named `VSCE_PAT`
3. Update the `VSCE_PAT` in the release workflow (`.github/workflows/release.yml` or similar):

   ```yaml
   env:
     GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
     VSCE_PAT: ${{ secrets.VSCE_PAT }}
   ```

## Skipping Releases

To skip a release for a commit, add `[skip ci]` or `[skip release]` to the commit message:

```bash
git commit -m "chore: update docs [skip ci]"
```

## Troubleshooting

### No release was created

**Possible reasons:**

- No commits with `feat:` or `fix:` since last release
- Only commits with `docs:`, `chore:`, etc.
- Commit doesn't follow conventional format

**Solution:** Ensure at least one commit has `feat:` or `fix:` type.

### Release failed

Check the GitHub Actions logs for errors. Common issues:

- Test failures (fix tests first)
- Linting errors (run `npm run lint`)
- Invalid commit messages (use conventional format)

## Manual Release (Fallback)

If you need to create a manual release, you can still push tags:

```bash
npm version patch  # or minor, major
git push origin main --tags
```

The manual-release job (currently commented out in the workflow) can be enabled for this.

## Benefits Over Manual Releases

✅ **Automated version bumping** - No manual package.json edits
✅ **Consistent changelog** - Auto-generated from commits
✅ **No manual tagging** - Tags created automatically
✅ **Enforces commit standards** - Must use conventional commits
✅ **Audit trail** - Clear history of what changed in each version
✅ **Less human error** - Automation handles the details
