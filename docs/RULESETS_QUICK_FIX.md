# Quick Fix for GitHub Rulesets + Semantic Release

**Problem**: Deploy keys don't work with GitHub Rulesets. Semantic-release can't push version commits.

## Recommended Solution: Use PAT with Ruleset Bypass

### Step 1: Create Personal Access Token (PAT)

1. Go to https://github.com/settings/tokens?type=beta
2. Click "Generate new token"
3. Configure:
   - **Token name**: `semantic-release-advanced-vscode-extension`
   - **Expiration**: 1 year (or your preference)
   - **Repository access**: "Only select repositories" → `JuliaPluto/advanced-vscode-extension`
   - **Permissions**:
     - Repository permissions → Contents: **Read and write**
     - Repository permissions → Pull requests: **Read and write**
     - Repository permissions → Issues: **Read and write**
4. Click "Generate token"
5. **Copy the token** (you won't see it again)

### Step 2: Add PAT as Repository Secret

1. Go to https://github.com/JuliaPluto/advanced-vscode-extension/settings/secrets/actions
2. Click "New repository secret"
3. Name: `GH_PAT`
4. Value: Paste your token
5. Click "Add secret"

### Step 3: Configure Ruleset Bypass

1. Go to https://github.com/JuliaPluto/advanced-vscode-extension/settings/rules
2. Click on your main branch ruleset (or create one if needed)
3. Scroll to "Bypass list"
4. Click "Add bypass"
5. Choose one of these options:

**Option A - Repository admins** (if your PAT is from an admin):

- Select "Repository admin"
- Click "Add"

**Option B - Specific user** (if your PAT is from a specific user):

- Select "Organization members" or "Repository collaborators"
- Add the user who created the PAT
- Click "Add"

6. Ensure these rules have bypass enabled:
   - ✅ Require pull request before merging
   - ✅ Require status checks to pass
   - ✅ Any other blocking rules

7. Click "Save changes"

### Step 4: Test the Configuration

Test manually with a simple push:

```bash
# Use your PAT to clone
git clone https://YOUR_PAT@github.com/JuliaPluto/advanced-vscode-extension.git test-repo
cd test-repo
git checkout main

# Create test commit
echo "# Test" >> TEST.md
git add TEST.md
git commit -m "test: ruleset bypass verification"

# Try to push - this should succeed if configured correctly
git push origin main

# If successful, clean up
git reset --hard HEAD~1
git push --force origin main
rm TEST.md
cd ..
rm -rf test-repo
```

If the push fails, your ruleset bypass is not configured correctly. Check:

- The PAT owner is in the bypass list
- The PAT has Contents: Read and write permission
- The ruleset is actually active for the main branch

### Step 5: Trigger Release

Once configured, you can trigger a release manually:

1. Go to https://github.com/JuliaPluto/advanced-vscode-extension/actions/workflows/release.yml
2. Click "Run workflow"
3. Select branch: `main`
4. Enable "Dry run" for testing: ✅
5. Click "Run workflow"

Check the logs. If dry-run succeeds, uncheck "Dry run" and run again for real release.

---

## Alternative: Release Without Pushing Commits

If you don't want to manage rulesets bypass, switch to no-commit mode:
remove the `@semantic-release/git` plugin block from `.releaserc.json` and
commit that change.

This mode:

- ✅ Creates GitHub releases
- ✅ Attaches VSIX files
- ✅ Generates release notes
- ❌ Doesn't update package.json version in repository
- ❌ Doesn't update CHANGELOG.md in repository

You manage versions manually in this mode.

### Switch Back to With-Commit Mode

Restore the `@semantic-release/git` plugin block in `.releaserc.json`
(see git history) and commit the change.

---

## Verification Checklist

Before running semantic-release:

- [ ] `GH_PAT` secret exists in repository secrets
- [ ] PAT has Contents: Read/Write permission
- [ ] PAT owner is in ruleset bypass list
- [ ] Ruleset applies to main branch
- [ ] Test push with PAT succeeds
- [ ] Workflow has been updated (already done)

## Common Issues

### "push declined due to repository rule violations"

**Cause**: PAT owner is not in the ruleset bypass list.

**Fix**: Add the PAT owner to bypass list in ruleset settings.

### "Resource not accessible by integration"

**Cause**: PAT doesn't have required permissions.

**Fix**: Recreate PAT with Contents: Read and Write permission.

### Still not working?

Check the ruleset run logs:

1. Go to Settings → Rules → Rulesets
2. Click "View runs"
3. Find the failed push
4. See exactly which rule blocked it

This will tell you what needs to be bypassed.
