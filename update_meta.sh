#!/bin/bash
set -e

# Set env vars for local testing
export GITHUB_REF_NAME=${GITHUB_REF_NAME:-$(git branch --show-current)}
export VERSION=${VERSION:-$GITHUB_REF_NAME}

# Compute version and versionCode
if [[ "$VERSION" == "dev" ]]; then
    VERSION_CODE=0
elif [[ "$VERSION" =~ ^v ]]; then
    NUM=$(echo "$VERSION" | sed 's/v//')
    VERSION_CODE=$(echo "$NUM" | awk '{print int($1 * 1000)}')
else
    echo "Invalid version format: $VERSION"
    exit 1
fi

# Update JSONs
python3 -c "
import json
for s in ['-GUI', '-CLI']:
    with open(f'update{s}.json') as f: data = json.load(f)
    data['version'] = '$VERSION'
    data['versionCode'] = $VERSION_CODE
    with open(f'update{s}.json', 'w') as f: json.dump(data, f, indent=2)"

# Update Changelog
# Get last tag
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

# Get commits from main
if [ -z "$LAST_TAG" ]; then
    MAIN_COMMITS=$(git log --oneline --pretty=format:"- %s")
else
    MAIN_COMMITS=$(git log --oneline --pretty=format:"- %s" $LAST_TAG..HEAD)
fi

# Get commits from gui branch
git fetch origin gui
if [ -z "$LAST_TAG" ]; then
    GUI_COMMITS=$(git log --oneline --pretty=format:"- %s" origin/gui)
else
    GUI_COMMITS=$(git log --oneline --pretty=format:"- %s" $LAST_TAG..origin/gui)
fi

# Combine, sort, uniq
ALL_COMMITS=$(echo -e "$MAIN_COMMITS\n$GUI_COMMITS" | sort | uniq)

# Format as markdown
NEW_ENTRY="## $GITHUB_REF_NAME ($(date +%Y-%m-%d))\n$ALL_COMMITS\n\n## Previous Versions\n- Initial release with basic chroot setup"

# Update CHANGELOG.md (replace from ## v2.5 onwards)
sed -i '/^## v2.5 (Latest)/,/^$/{d}' CHANGELOG.md
echo -e "# Changelog\n\n$NEW_ENTRY" > CHANGELOG.md
