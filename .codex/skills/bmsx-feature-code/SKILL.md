---
name: bmsx-feature-code
description: "Use when implementing BMSX features, bug fixes, runtime behavior, cart APIs, IDE behavior, render/audio/video work, or platform support. This skill permits new code, but only when it fits the existing owner model and does not make touched code worse. If the feature needs cleanup first, stop and use bmsx-lean-code for that slice."
metadata:
  short-description: "Implement BMSX features cleanly"
---

# BMSX Feature Code

Use this for normal feature and bug-fix work. Keep it simple: find the owner,
add the behavior there, and do not make the touched code worse.

## Before Editing

Read nearby code and nearest `AGENTS.md`. Search with `rg` for existing owners,
state, helpers, APIs, and TS/C++ counterparts. Use serious reference
implementations when useful.

## Feature Gate

Feature code is allowed when it has a concrete owner, preserves the
fantasy-console contract, and keeps performance-sensitive paths direct.

Stop and switch to `bmsx-lean-code` if the feature would require wrappers,
lazy init, defensive clutter, facade/host/provider/service layers, hidden
analyzer skips, compatibility fallbacks, or broad cleanup first.

When touching code that is already a mess, keep the feature slice small. Do not
copy the mess, and do not pretend tagged/suppressed code is clean. If a local
comment or analysis tag is needed, make it clear that the tagged code is debt,
exceptional, or an unavoidable boundary.

## Validation

Use the existing project build+validate npm entrypoint for the touched area.
Add narrower analyzer/build/headless runs only when the feature needs extra
proof. Always run `git diff --check`.

Use `TMPDIR=/tmp` for `tsx` commands when this environment needs it.
