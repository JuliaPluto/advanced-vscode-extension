# Release Workflow

This project uses semantic-release in **no-commit mode** to handle releases.

## How It Works

When commits are pushed to `main`, the release workflow:

1. ✅ Analyzes commit messages to determine version bump (feat = minor, fix = patch, etc.)
2. ✅ Generates release notes from commits
3. ✅ Packages the extension as a VSIX file
4. ✅ Creates a GitHub release with the VSIX attached
5. ✅ Tags the release
6. ❌ **Does NOT** push version changes back to the repository

## Why No-Commit Mode?

We use no-commit mode because:

- GitHub Rulesets protect the main branch
- No need to configure PAT bypass for pushing commits
- Simpler workflow with fewer permissions required
- Version bumps are manual and intentional

## Managing Versions

Since semantic-release doesn't update `package.json` automatically, you need to update versions manually.

### Before Making a Release

1. Update version in `package.json`:

   ```json
   {
     "version": "0.2.0-alpha"
   }
   ```

2. Update `CHANGELOG.md`:

   ```markdown
   ## [Unreleased]

   ## [0.2.0-alpha] - 2025-10-13

   ### Added

   - New feature here
   ```

3. Commit the changes:

   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore: bump version to 0.2.0-alpha"
   git push origin main
   ```

4. The release workflow will automatically:
   - Build the VSIX with the new version
   - Create a GitHub release
   - Attach the VSIX artifact
   - Use your CHANGELOG content in release notes

### Versioning Strategy

We use semantic versioning with alpha/beta tags during early development:

- `0.1.0-alpha` - Initial alpha release
- `0.2.0-alpha` - Second alpha with new features
- `0.2.1-alpha` - Alpha patch release
- `0.3.0-beta` - First beta release
- `1.0.0` - First stable release

### Conventional Commits

Use conventional commits for automatic release note generation:

- `feat: add new feature` → Adds to "Features" section
- `fix: resolve bug` → Adds to "Bug Fixes" section
- `docs: update readme` → Adds to "Documentation" section
- `chore: update deps` → Adds to "Maintenance" section
- `BREAKING CHANGE:` → Highlights breaking changes

## Manual Release Trigger

You can trigger a release manually from GitHub Actions:

1. Go to Actions → Release workflow
2. Click "Run workflow"
3. Select branch: `main`
4. Choose dry-run option if testing
5. Click "Run workflow"

## Dry Run Testing

Test the release process without creating an actual release:

```bash
npx semantic-release --dry-run
```

This will:

- Analyze commits
- Determine what version would be released
- Show what files would be included
- Not create any release or tag

## Switching to With-Commit Mode

If you later want semantic-release to automatically update versions:

```bash
# Switch configs
mv .releaserc.json .releaserc.no-commit.json
mv .releaserc.with-commit.json .releaserc.json

# Update workflow
# Edit .github/workflows/release.yml:
# - Add GH_PAT token configuration
# - Add git committer environment variables

# Commit
git add .releaserc.json .releaserc.with-commit.json .github/workflows/release.yml
git commit -m "chore: switch to semantic-release with commits"
git push
```

See `docs/RULESETS_QUICK_FIX.md` for setting up PAT bypass with GitHub Rulesets.

## Release Checklist

Before each release:

- [ ] Update version in `package.json`
- [ ] Update `CHANGELOG.md` with new version section
- [ ] Review commit messages since last release
- [ ] Test extension locally (`F5` in VSCode)
- [ ] Run `npm run compile` to check for errors
- [ ] Run `npm run test:unit` to verify tests pass
- [ ] Commit version changes
- [ ] Push to main (triggers automatic release)
- [ ] Verify release created on GitHub
- [ ] Download and test the VSIX artifact

## Files Involved

- `.releaserc.json` - Current config (no-commit mode)
- `.releaserc.with-commit.json` - Alternative config (with commits)
- `.github/workflows/release.yml` - Release workflow
- `package.json` - Version number (manual updates)
- `CHANGELOG.md` - Release notes (manual updates)

## Troubleshooting

### Release not created

Check:

1. Commits use conventional commit format
2. There are unreleased changes since last tag
3. Version in package.json is different from last release

### Wrong version in release

The version comes from `package.json`, not from commits. Make sure to update it before pushing.

### VSIX not attached

Check the workflow logs. The VSIX build happens before semantic-release, so if it fails, check the build logs.

## References

- [Semantic Release](https://semantic-release.gitbook.io/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/)
- [VSCE Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
