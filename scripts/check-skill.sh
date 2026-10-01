#!/usr/bin/env bash
# check-skill.sh — static checks for this skill repository.
#
#   scripts/check-skill.sh [--require-claude] [--online]
#
# Fails on: missing name or description, a name that differs from its
# directory, a SKILL.md over 500 lines; a broken relative link (and with
# --online a dead external link); `allowed-tools` in any frontmatter, a skill
# line that starts with an exclamation mark and a backtick, or the paths
# hooks/, .mcp.json, bin/ or a root CLAUDE.md; a package-runner call to the
# unscoped `privos-app` bin; `claude plugin validate . --strict` failing.
# Without the claude CLI that last check is skipped, unless --require-claude
# makes it a failure.
set -euo pipefail

require_claude=0 online=0
for arg in "$@"; do
	case "$arg" in
		--require-claude) require_claude=1 ;;
		--online) online=1 ;;
		*) sed -n '2,4p' "$0" >&2; exit 1 ;;
	esac
done

cd "$(dirname "$0")/.."
failed=0 failures=0 mark=0
fail() { printf 'FAIL %s\n' "$*"; failed=1; failures=$((failures + 1)); }
# PASS only when the section that just ended reported no failure.
ok() { ((failures > mark)) || printf 'PASS %s\n' "$*"; mark=$failures; }

mapfile -t skill_files < <(find skills -name SKILL.md | sort)
[[ ${#skill_files[@]} -gt 0 ]] || fail "no skills/*/SKILL.md"
mapfile -t md_files < <(git ls-files -co --exclude-standard -- '*.md' | sort)

frontmatter() { awk 'NR==1 && $0=="---" {f=1; next} f && $0=="---" {exit} f' "$1"; }

# --- frontmatter and size ---------------------------------------------------
for file in "${skill_files[@]}"; do
	dir="$(basename "$(dirname "$file")")"
	name="$(frontmatter "$file" | sed -n 's/^name:[[:space:]]*//p' | head -n 1)"
	description="$(frontmatter "$file" | sed -n 's/^description:[[:space:]]*//p' | head -n 1)"
	[[ -n "$name" ]] || fail "$file: missing name"
	[[ -n "$description" ]] || fail "$file: missing description"
	[[ -z "$name" || "$name" == "$dir" ]] || fail "$file: name '$name' differs from directory '$dir'"
	lines="$(wc -l <"$file")"
	((lines <= 500)) || fail "$file: $lines lines (max 500)"
done
ok "frontmatter and size"

# --- executable content ------------------------------------------------------
for file in "${md_files[@]}"; do
	if frontmatter "$file" | grep -q '^allowed-tools:'; then fail "$file: allowed-tools grants tools without a prompt"; fi
done
while IFS= read -r hit; do fail "$hit: a line starting with !\` runs a shell command when the skill loads"; done \
	< <(grep -rn --include='*' '^!`' skills | cut -d: -f1,2 || true)
for path in hooks .mcp.json bin CLAUDE.md; do
	[[ ! -e "$path" ]] || fail "$path: plugins must not ship hooks, MCP servers, binaries or a root CLAUDE.md"
done
ok "executable content"

# --- unscoped CLI runner calls ----------------------------------------------
runner='(npx|npm exec|pnpm dlx|bunx|yarn dlx)\b[^\n`]*\bprivos-app(-lint)?(?![\w.-])'
while IFS= read -r hit; do fail "$hit: name the scoped package (-p @privos_ai/app-server)"; done \
	< <(git ls-files -co --exclude-standard | grep -v '^scripts/check-skill.sh$' |
		xargs -r grep -nP "$runner" 2>/dev/null | grep -v -- '-p @privos_ai/app-server' | cut -d: -f1,2 || true)
ok "runner calls"

# --- links -------------------------------------------------------------------
external=()
for file in "${md_files[@]}"; do
	base="$(dirname "$file")"
	while IFS= read -r target; do
		target="${target%%#*}"
		[[ -n "$target" ]] || continue
		case "$target" in
			http://* | https://*) external+=("$target") ;;
			mailto:*) ;;
			/*) fail "$file: absolute link $target" ;;
			*) [[ -e "$base/$target" ]] || fail "$file: broken link $target" ;;
		esac
	done < <(grep -oP '\]\(\K[^)\s]+' "$file" || true)
done
if ((online)); then
	for url in $(printf '%s\n' "${external[@]}" | sort -u); do
		code="$(curl -sL -o /dev/null -w '%{http_code}' --max-time 20 "$url" || true)"
		[[ "$code" =~ ^(2|3)[0-9][0-9]$ ]] || fail "dead link ($code): $url"
	done
	ok "links (with external)"
else
	ok "links (relative only)"
fi

# --- plugin manifests ----------------------------------------------------------
if command -v claude >/dev/null; then
	if claude plugin validate . --strict >/tmp/check-skill-validate.$$ 2>&1; then
		ok "claude plugin validate --strict"
	else
		fail "claude plugin validate --strict: $(tail -n 5 /tmp/check-skill-validate.$$ | tr '\n' ' ')"
	fi
	rm -f /tmp/check-skill-validate.$$
elif ((require_claude)); then
	fail "claude CLI not found (required)"
else
	printf 'SKIPPED claude plugin validate (no claude CLI)\n'
fi

exit "$failed"
