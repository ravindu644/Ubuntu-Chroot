#!/bin/bash
set -e

# Check for required dependencies
deps=("rsync" "python3")
for dep in "${deps[@]}"; do
    if ! command -v "$dep" >/dev/null 2>&1; then
        echo "$dep is required but not installed."
        exit 1
    fi
done

VARIANT=$1
TAG=${2:-dev}
UPDATE_FLAG=$3

# Validate TAG format
if [[ "$TAG" != "dev" && ! "$TAG" =~ ^v[0-9] ]]; then
    echo "Tag must start with 'v' followed by a number, e.g., v3 or v2.5"
    exit 1
fi

if [ "$VARIANT" = "cli" ]; then
    SUFFIX="-CLI"
elif [ "$VARIANT" = "gui" ]; then
    SUFFIX="-GUI"
else
    echo "Usage: $0 <cli|gui> [tag] [--update]"
    exit 1
fi

DATE=$(date +%Y%m%d)
if [ "$UPDATE_FLAG" = "--update" ]; then
    ZIP_NAME="update${SUFFIX}.zip"
    EXCLUDE_TAR="--exclude='*.tar.gz'"
else
    ZIP_NAME="Ubuntu-Chroot-${TAG}-${DATE}${SUFFIX}.zip"
    EXCLUDE_TAR=""
fi

# Remove any existing ZIP files
rm -f *.zip

TMP_DIR=$(mktemp -d)

# Copy all files except excluded
rsync -a --exclude='.git*' --exclude='Docker' --exclude='update-*.json' --exclude='update_meta.sh' --exclude='build_zip.sh' $EXCLUDE_TAR "$PWD/" "$TMP_DIR/"

# Update update JSON
VERSION_CODE=$(echo "$TAG" | sed 's/v//' | awk '{print int($1 * 1000)}')
cp "update${SUFFIX}.json" "$TMP_DIR/update.json"

# Update module.prop
sed -i "s|^version=.*|version=${TAG}|" "$TMP_DIR/module.prop"
sed -i "s|^versionCode=.*|versionCode=${VERSION_CODE}|" "$TMP_DIR/module.prop"
sed -i "s|^updateJson=.*|updateJson=https://raw.githubusercontent.com/ravindu644/Ubuntu-Chroot/main/update${SUFFIX}.json|" "$TMP_DIR/module.prop"

# Update update.json
python3 -c "
import json
with open('$TMP_DIR/update.json') as f: data = json.load(f)
data['version'] = '$TAG'
data['versionCode'] = $VERSION_CODE
with open('$TMP_DIR/update.json', 'w') as f: json.dump(data, f, indent=2)"

# Create ZIP
ORIGINAL_PWD=$PWD
cd "$TMP_DIR"
zip -r -9 "$ORIGINAL_PWD/$ZIP_NAME" .
cd "$ORIGINAL_PWD"
rm -rf "$TMP_DIR"

echo "Created $ZIP_NAME"
