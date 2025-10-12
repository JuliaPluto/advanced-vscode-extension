# Release Setup Guide

This document explains how to configure releases for the Pluto Notebook extension with protected main branch.

## Problem

When the `main` branch is protected, semantic-release cannot push version bump commits directly, causing the release workflow to fail.

## Solution

We use a Personal Access Token (PAT) with bypass permissions to allow semantic-release to push to protected branches.

## Setup Instructions

### 1. Create a Personal Access Token (PAT)

1. Go to GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Click "Generate new token"
3. Configure the token:
   - **Name**: `semantic-release-bypass` (or similar)
   - **Expiration**: Set as needed (recommend 1 year)
   - **Repository access**: Select "Only select repositories" → Choose this repository
   - **Permissions**:
     - **Repository permissions**:
       - Contents: Read and write
       - Pull requests: Read and write
       - Issues: Read and write
       - Metadata: Read-only (automatically selected)

4. Click "Generate token" and copy the token value

### 2. Add Token as Repository Secret

1. Go to your repository on GitHub
2. Navigate to Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Add:
   - **Name**: `GH_PAT`
   - **Secret**: Paste the token you created

### 3. Configure Branch Protection (Rulesets or Legacy)

#### Option A: GitHub Rulesets (Recommended - Newer Repositories)

**Important**: Deploy keys do NOT work with rulesets for semantic-release. You need to bypass for specific actors.

1. Go to Settings → Rules → Rulesets
2. Find or create a ruleset that applies to the `main` branch
3. Configure bypass permissions:

**Method 1: Bypass for Repository Admin (Simplest)**
   - Under "Bypass list", click "Add bypass"
   - Select "Repository admin"
   - This allows repository admins to bypass (semantic-release will use admin PAT)

**Method 2: Bypass for GitHub App**
   - Under "Bypass list", click "Add bypass"
   - Select "GitHub Apps"
   - Add the GitHub Actions app if available

**Method 3: Bypass for Specific User**
   - Create a PAT (see step 1)
   - Under "Bypass list", click "Add bypass"
   - Select "Organization members" or "Repository collaborators"
   - Add the user who owns the PAT

4. Ensure these ruleset settings allow semantic-release to work:
   - **Require pull request before merging**: Add bypass for your chosen actor
   - **Require status checks to pass**: Add bypass for your chosen actor
   - **Require linear history**: Can be enabled (semantic-release creates merge commits)
   - **Block force pushes**: Keep enabled (semantic-release doesn't force push)

#### Option B: Legacy Branch Protection Rules

1. Go to Settings → Branches → Branch protection rules
2. Edit the rule for `main`
3. Enable "Allow specified actors to bypass required pull requests"
4. Add the GitHub Actions bot or your PAT user to the bypass list

Alternatively, you can allow the GitHub Actions bot to bypass protection:
- In branch protection, check "Do not allow bypassing the above settings" = OFF
- Or specifically allow `github-actions[bot]` to bypass

### 4. Workflow Configuration

The release workflow (`.github/workflows/release.yml`) is configured to:

- Use `GH_PAT` if available, fall back to `GITHUB_TOKEN`
- Allow manual triggering via `workflow_dispatch`
- Support dry-run mode for testing
- Set proper git committer information

## Manual Release Trigger

You can manually trigger a release from the GitHub Actions tab:

1. Go to Actions → Release workflow
2. Click "Run workflow"
3. Choose options:
   - **Branch**: main
   - **Dry run**: Check to test without creating a release
4. Click "Run workflow"

## Testing the Setup

### Dry Run Test

```bash
# Manually trigger with dry-run from GitHub UI
# OR locally test semantic-release:
npx semantic-release --dry-run
```

### Check Configuration

```bash
# Verify git credentials in workflow
git config user.name
git config user.email
```

## How It Works

1. **Token Priority**: Workflow uses `GH_PAT` secret if available, otherwise `GITHUB_TOKEN`
2. **Credentials**: Checkout action uses the PAT to authenticate git operations
3. **Git Identity**: Workflow sets git author/committer to `github-actions[bot]`
4. **Bypass**: PAT with proper permissions can push to protected branches
5. **Manual Trigger**: `workflow_dispatch` allows on-demand releases

## Semantic Release Flow

When the workflow runs:

1. CI runs (lint, test, build)
2. Checkout with PAT credentials
3. Build VSIX package
4. Run semantic-release:
   - Analyzes commits since last release
   - Determines version bump (major/minor/patch)
   - Updates package.json and CHANGELOG.md
   - Creates git tag
   - Pushes commit and tag (using PAT)
   - Creates GitHub release with VSIX attached

## Alternative: No Version Commits

If you prefer not to push version commits to main, update `.releaserc.json`:

```json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ["@semantic-release/changelog", { "changelogFile": "CHANGELOG.md" }],
    ["@semantic-release/npm", { "npmPublish": false }],
    ["semantic-release-vsce", { "packageVsix": true }],
    [
      "@semantic-release/github",
      {
        "assets": [
          { "path": "*.vsix", "label": "VS Code Extension (VSIX)" },
          { "path": "CHANGELOG.md", "label": "Changelog" }
        ]
      }
    ]
    // Remove @semantic-release/git to skip version commits
  ]
}
```

This creates releases without pushing version bumps back to main.

## Troubleshooting

### "refusing to allow a Personal Access Token to create or update workflow"

Solution: The PAT needs "Workflows" permission. Recreate the token with this permission added.

### "protected branch hook declined" or "Resource protected by organization SAML enforcement"

**For GitHub Rulesets:**
1. Verify the PAT owner is in the bypass list (not deploy keys)
2. Check Settings → Rules → Rulesets → View ruleset runs to see why it was blocked
3. Ensure the ruleset bypass includes the correct actor type (Repository admin, Org member, or App)
4. If using org-level rulesets, you may need org admin permissions

**For Legacy Protection:**
Solution: Ensure the PAT user or github-actions[bot] is in the bypass list for branch protection.

### "Author identity unknown"

Solution: The workflow sets `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL` environment variables. Check they're properly configured.

### Dry-run succeeds but real run fails

Check:
1. `GH_PAT` secret is properly set
2. PAT has not expired
3. PAT has correct permissions (Contents: R/W minimum)
4. Branch protection/rulesets allow bypass for the PAT owner
5. PAT is authorized for SSO (if applicable)

### Deploy keys don't work with Rulesets

This is expected. Deploy keys cannot be added to ruleset bypass lists. Solutions:
1. Use a Personal Access Token (PAT) instead
2. Add the PAT owner to the ruleset bypass list
3. Use "Repository admin" bypass if the PAT is from an admin

### Verifying Ruleset Configuration

Test if your PAT can push to protected branch:

```bash
# Clone with PAT
git clone https://<PAT>@github.com/JuliaPluto/advanced-vscode-extension.git
cd advanced-vscode-extension
git checkout main

# Make a test commit
echo "test" >> test.txt
git add test.txt
git commit -m "test: ruleset bypass"
git push

# If this fails, your ruleset bypass is not configured correctly
# Clean up
git reset --hard HEAD~1
git push --force
```

### Alternative: Skip Version Commits

If you can't get rulesets to allow pushes, configure semantic-release to skip version commits and only create tags/releases:

Update `.releaserc.json`:
```json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ["@semantic-release/npm", { "npmPublish": false }],
    ["semantic-release-vsce", { "packageVsix": true }],
    [
      "@semantic-release/github",
      {
        "assets": [
          { "path": "*.vsix", "label": "VS Code Extension (VSIX)" }
        ]
      }
    ]
  ]
}
```

This removes:
- `@semantic-release/changelog` - no changelog updates
- `@semantic-release/git` - no version commits to main

Releases are created without pushing back to the repository.

## Security Notes

- **PAT Security**: Store PAT only as a GitHub secret, never commit it
- **Token Scope**: Use fine-grained tokens with minimal required permissions
- **Expiration**: Set reasonable expiration dates and rotate tokens regularly
- **Audit**: Review GitHub audit logs for PAT usage

## References

- [Semantic Release GitHub Action](https://github.com/semantic-release/semantic-release/blob/master/docs/recipes/ci-configurations/github-actions.md)
- [GitHub PAT Documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
- [Branch Protection Bypass](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
