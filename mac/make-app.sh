#!/bin/sh
# Builds "Translation Review Public.app", which opens the review app in Google Chrome (the browser that can save over files).
# Usage: sh mac/make-app.sh [folder]   (default folder: /Applications, the one Finder shows)
# Run it again if you move this repo folder.
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
INDEX="$DIR/app/index.html"
DEST="${1:-/Applications}"
APP="$DEST/Translation Review Public.app"
[ -f "$INDEX" ] || { echo "Can't find $INDEX"; exit 1; }
mkdir -p "$DEST"
rm -rf "$APP"
ESCAPED=$(printf '%s' "$INDEX" | sed 's/\\/\\\\/g; s/"/\\"/g')
osacompile -o "$APP" \
  -e "set page to \"$ESCAPED\"" \
  -e 'try' \
  -e '  do shell script "open -a " & quoted form of "Google Chrome" & " " & quoted form of page' \
  -e 'on error' \
  -e '  do shell script "open " & quoted form of page' \
  -e 'end try'
echo "Installed: $APP"
