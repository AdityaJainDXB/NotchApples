#!/bin/zsh
# Uncommitted changes in a Git repository. Change REPO to your project folder.
REPO="$HOME/Developer/my-project"
if [ ! -d "$REPO/.git" ]; then
  echo "Git status"
  echo "Edit REPO at the top of this plugin"
  exit 0
fi
cd "$REPO"
branch=$(git branch --show-current)
changes=$(git status --porcelain | wc -l | tr -d ' ')
echo "$(basename "$REPO") · $branch"
echo "$changes uncommitted change(s)"
git log -1 --pretty='Last commit: %s (%cr)'
echo "Open in Terminal | run=open -a Terminal \"$REPO\""
