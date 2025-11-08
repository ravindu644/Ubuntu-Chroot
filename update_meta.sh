#!/bin/bash
set -e

# Set env vars for local testing
export GITHUB_REF_NAME=${GITHUB_REF_NAME:-$(git branch --show-current)}
export VERSION=${VERSION:-$GITHUB_REF_NAME}

echo "=== Metadata Update Script ==="
echo "Current VERSION: $VERSION"
echo "GITHUB_REF_NAME: $GITHUB_REF_NAME"

# Validate version format
if [[ "$VERSION" == "dev" ]]; then
    VERSION_CODE=0
    echo "Dev version detected, VERSION_CODE set to 0"
elif [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+ ]]; then
    NUM=$(echo "$VERSION" | sed 's/v//')
    VERSION_CODE=$(echo "$NUM" | awk '{print int($1 * 1000)}')
    echo "Release version: $VERSION, VERSION_CODE: $VERSION_CODE"
else
    echo "ERROR: Invalid version format: $VERSION"
    echo "Expected format: vX.Y or dev"
    exit 1
fi

# Update JSON files
echo "Updating JSON files..."
python3 -c "
import json
import sys

for suffix in ['-GUI', '-CLI']:
    filename = f'update{suffix}.json'
    try:
        with open(filename) as f:
            data = json.load(f)
        
        data['version'] = '$VERSION'
        data['versionCode'] = $VERSION_CODE
        
        with open(filename, 'w') as f:
            json.dump(data, f, indent=2)
            f.write('\n')  # Add newline at end
        
        print(f'Updated {filename}')
    except FileNotFoundError:
        print(f'Warning: {filename} not found', file=sys.stderr)
    except Exception as e:
        print(f'Error updating {filename}: {e}', file=sys.stderr)
        sys.exit(1)
"

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to update JSON files"
    exit 1
fi

# === Changelog Generation ===
echo ""
echo "=== Generating Changelog ==="

# Synchronize tags with remote (prune local, fetch all remote)
echo "Synchronizing tags with remote..."
git fetch origin --prune --prune-tags --tags 2>/dev/null || true
echo "Tags synchronized"

# Get all tags sorted by version
ALL_TAGS=$(git tag --sort=-version:refname)
echo "Available tags:"
echo "$ALL_TAGS"

# Get the previous tag (skip current version if it exists)
CURRENT_TAG="$VERSION"
PREV_TAG=$(echo "$ALL_TAGS" | grep -v "^${CURRENT_TAG}$" | head -1)

if [ -z "$PREV_TAG" ]; then
    echo "No previous tag found - this is the first release"
    RANGE_SPEC=""
else
    echo "Previous tag: $PREV_TAG"
    echo "Current tag: $CURRENT_TAG"
    RANGE_SPEC="$PREV_TAG.."
fi

# Get commits from main branch only (between the two tags)
echo ""
echo "Getting commits from main branch..."
if [ -z "$RANGE_SPEC" ]; then
    # First release - get all commits
    ALL_COMMITS=$(git log origin/main --oneline --pretty=format:"- %s" 2>/dev/null || git log --oneline --pretty=format:"- %s")
else
    # Get commits between previous tag and current tag on main branch
    ALL_COMMITS=$(git log --oneline --pretty=format:"- %s" ${PREV_TAG}..${CURRENT_TAG} 2>/dev/null || echo "")
fi

# Count commits
COMMIT_COUNT=$(echo "$ALL_COMMITS" | grep -c '^' || echo "0")
echo "Total unique commits: $COMMIT_COUNT"

if [ "$COMMIT_COUNT" -eq 0 ]; then
    echo "Warning: No commits found between $PREV_TAG and current state"
    ALL_COMMITS="- No changes recorded"
fi

# Generate new changelog (clear and recreate)
echo ""
echo "Writing new CHANGELOG.md..."
cat > CHANGELOG.md << EOF
# Changelog

## $VERSION ($(date +%Y-%m-%d))

$ALL_COMMITS
EOF

echo ""
echo "=== Metadata update complete ==="
echo "Updated files:"
echo "  - update-GUI.json"
echo "  - update-CLI.json"
echo "  - CHANGELOG.md"
echo ""
echo "Changelog preview:"
head -n 20 CHANGELOG.md
