#!/bin/bash
set -e

MAX_ITERATIONS=100
i=0

while [ $i -lt $MAX_ITERATIONS ]; do
  i=$((i + 1))
  
  # Find and remove "deleted by us" files
  du_files=$(git status --porcelain 2>/dev/null | grep "^DU " | awk '{print $2}')
  if [ -n "$du_files" ]; then
    echo "$du_files" | while IFS= read -r f; do
      git rm "$f" 2>/dev/null || true
    done
  fi
  
  # Checkout ours for all remaining unmerged
  unmerged=$(git diff --name-only --diff-filter=U 2>/dev/null)
  if [ -n "$unmerged" ]; then
    echo "$unmerged" | while IFS= read -r f; do
      git checkout --ours "$f" 2>/dev/null || true
    done
  fi
  
  git add -A
  
  if GIT_EDITOR=true git rebase --continue 2>/tmp/rebase-output.txt; then
    echo "=== REBASE COMPLETE after $i iterations ==="
    cat /tmp/rebase-output.txt | grep "Rebasing" | tail -1
    break
  fi
  
  output=$(cat /tmp/rebase-output.txt)
  
  if echo "$output" | grep -q "CONFLICT"; then
    step=$(echo "$output" | grep "Rebasing" | tail -1)
    echo "Step $i: $step (resolving...)"
  else
    echo "=== UNEXPECTED ERROR at step $i ==="
    cat /tmp/rebase-output.txt
    exit 1
  fi
done
