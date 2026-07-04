# CLAUDE.md

Project guidance for Claude Code. Keep this concise — add rules, not prose.

## Git workflow: delivering completed work to `main`

**Claude drives git; the user does not run git concurrently.** When delivering or
merging work, Claude performs all git operations end-to-end. Do not run git commands
in the terminal at the same time — two actors mutating the repo at once corrupts the
state (mid-operation the branch tip, staged files, and conflict markers all shift
underfoot, and it's easy to push the wrong thing).

**Ship completed work only, via PR.** Exclude WIP commits and uncommitted
in-progress work. Split each completed piece onto its own feature branch and open a
PR to `main` (the pattern used by PRs #4–#7). Never push a scratch/working branch
wholesale to `main`.

**Scratch branches.** Branches like `feat/youtube-metadata-capture` are long-lived
working branches that accumulate everything (completed features + WIP side by side).
Completed pieces are cherry-picked/split into dedicated branches and PR'd; the
scratch branch itself is not merged to `main` as-is.
