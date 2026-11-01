#!/bin/bash
# PreToolUse guard for Bash: blocks a few commands that are almost never right in this repo (exit code 2 stops the call and
# tells the agent why). It reads the tool call as JSON on stdin and does nothing if it cannot parse it.
cmd=$(python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("tool_input",{}).get("command",""))
except Exception: pass' 2>/dev/null)
[ -z "$cmd" ] && exit 0
block() { echo "Blocked by .claude/hooks/guard-bash.sh: $1. Ask the owner first if this is really needed." >&2; exit 2; }
case "$cmd" in
  *"rm -rf /"*|*"rm -rf ~"*|*'rm -rf $HOME'*) block "recursive delete of / or the home folder" ;;
  *"git push --force"*|*"git push -f "*|*"git push -f"|*"--force-with-lease"*) block "force push" ;;
  *"git reset --hard"*|*"git clean -f"*) block "discarding local work" ;;
  *"| sh"*|*"|sh"*|*"| bash"*|*"|bash"*|*"| zsh"*) block "piping a download into a shell" ;;
  *"sudo "*) block "sudo" ;;
  *printenv*|*"env | "*|*"set | "*) block "dumping environment variables (they hold tokens)" ;;
  *".ssh/"*|*"id_rsa"*|*"id_ed25519"*) block "reading SSH keys" ;;
  *"security find-generic-password"*|*"security find-internet-password"*) block "reading the keychain" ;;
esac
exit 0
