# Repo Indexer

Index a codebase into a structured, maintainable REPO_INDEX.md that serves both humans (onboarding, architecture reviews) and agents (test design, code audits, code generation).

---

## Mode Detection

Before starting, check if REPO_INDEX.md already exists at the repo root:

- **No REPO_INDEX.md** → Full mode (build from scratch)
- **REPO_INDEX.md exists but is stale** (last_indexed_commit doesn't match HEAD, or >30% of files changed since last index) → Update mode
- **REPO_INDEX.md exists and is current** → Skip (report "index is current")

---

## Full Mode

### Front Matter

Start REPO_INDEX.md with metadata:

```
---
repo_index_schema_version: 1
last_indexed_commit: <SHA>
last_indexed_at: <ISO-8601 timestamp>
index_mode: full
workspaces: [list of workspace roots, e.g., backend/, webapp/, frontend/]
---
```

### Step 1 — Detect Repository Topology

Identify if this is a single app or monorepo. Look for workspace manifests (`package.json`, `pnpm-workspace.yaml`, `pyproject.toml`, `pubspec.yaml`, `Cargo.toml`, `go.mod`, etc.). Produce separate sections per workspace plus shared libraries if applicable.

### Step 2 — Map the Codebase

For each workspace/module, document:

**Use deterministic inclusion rules:** entry points, public API surfaces, domain models, persistence/migrations, auth/security, integration boundaries, configuration, and all test files. If a directory is summarized instead of file-by-file, state why.

For each included file:
- Path
- One-line description
- Key exports/endpoints/classes/functions

Organize by module/feature area within each workspace.

**Skip:** node_modules/, .git/, build/, dist/, __pycache__/, .dart_tool/, pods/, .gradle/, vendor/, .venv/, .next/, coverage/

### Step 3 — Tech Stack & Frameworks

For each workspace, identify:
- Language and runtime version
- Framework (FastAPI, Express, Next.js, Flutter, etc.)
- Database / persistence layer
- Auth mechanism
- External service integrations (Stripe, Firebase, AWS, etc.)
- Build tooling and package manager

### Step 4 — Dependency Map

For each module/feature area:
- Internal dependencies (what imports/calls what)
- Key external package dependencies (direct, not transitive)
- Note circular dependencies if found
- Note shared libraries used across workspaces

### Step 5 — API Contracts

For service/backend modules, list:
- Route/endpoint (method + path)
- Handler location (file:function)
- Auth requirement (public, authenticated, role-specific)
- Request shape (key fields, not full schema)
- Response shape (key fields)
- Primary error codes

For event-driven systems, list event names, publishers, and subscribers.

### Step 6 — Environment & Configuration

Extract from code, `.env.example`, settings files, CI configs:
- Variable name
- Required or optional
- Default value (if any)
- Consuming module
- Sensitive (yes/no)

### Step 7 — Test Inventory

Find ALL existing test files. For each:
- File path
- What module/feature it tests
- Test count (number of test functions/methods)
- Framework (pytest, jest, flutter_test, vitest, etc.)
- How to run (e.g., `pytest tests/`, `npm test`, `flutter test`)

Run the existing tests with bounded timeouts. Record:
- Command used
- Duration
- Pass / fail / skip / error counts
- Blockers (if suite can't run, document exact failure reasons)

If full suite isn't runnable (missing deps, env issues), run what's possible and document what was skipped and why.

### Step 8 — Risk & Hotspots (optional, if git history available)

- Most frequently changed files in last 30 days (`git log --since="30 days ago" --name-only --format=""  | sort | uniq -c | sort -rn | head -20`)
- Files with most authors (coordination risk)
- Large files that may need decomposition

---

## Update Mode

When REPO_INDEX.md exists but is stale:

1. Read the existing REPO_INDEX.md. Extract `last_indexed_commit` from front matter.

2. Compute diff:
   ```
   git diff --name-status -M -C <last_indexed_commit>...HEAD
   ```
   If the commit is missing or unreachable, try `git merge-base HEAD origin/main` as fallback. If that also fails, or if >30% of files changed, trigger a full reindex instead.

3. For each added/modified/renamed/deleted file:
   - Added → create new entry
   - Modified → update description, exports, test counts as needed
   - Renamed → update path, preserve description
   - Deleted → remove entry

4. Re-run test inventory (Step 7) to update pass/fail baseline.

5. Update front matter: `last_indexed_commit`, `last_indexed_at`, `index_mode: update`.

6. Don't rewrite entries that haven't changed.

---

## Output Quality Rules

- Be thorough but not verbose. One-line descriptions, not paragraphs.
- Accuracy over completeness. If you're unsure about a file's purpose, say so rather than guessing.
- The index should let a new engineer understand the architecture in 5 minutes.
- The index should let an agent (test designer, code reviewer) work without reading every file.
- Commit REPO_INDEX.md to the repo root when done.
