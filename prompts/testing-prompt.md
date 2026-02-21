# Production Test Suite Generator

Reusable prompt for generating comprehensive, production-grade test suites for any repo.

## Usage

Tell your assistant:
> "Run the testing prompt on [repo path]"

The assistant will orchestrate 4 sub-agents in sequence. Each agent writes its output to a file in the repo root that the next agent reads.

---

## Orchestration Flow

```
Agent 1 (Indexer)          → writes REPO_INDEX.md
        ↓
Agent 2 (Test Designer)    → reads REPO_INDEX.md → writes TEST_DESIGN.md
        ↓
Agent 3 (Architect Review) → reads TEST_DESIGN.md → writes DESIGN_REVIEW.md
        ↓
Agent 4 (Test Generator)   → reads TEST_DESIGN.md + DESIGN_REVIEW.md → writes test files, runs them
```

**Dependencies are strict** — each agent MUST wait for the previous agent to complete before starting. Do not run agents in parallel.

### Freshness Logic (applies to all agents)

Before running each agent, the orchestrator checks whether its output file already exists and is current:

1. **No output file exists** → run the agent (full mode)
2. **Output file exists but is stale** (older than the most recent git commit) → run the agent in **update mode** — read the existing file and patch/extend it rather than rebuilding from scratch
3. **Output file exists and is current** (newer than the most recent commit) → **skip** the agent

This means:
- Fresh repo with no artifacts → all 4 agents run
- Repo already indexed (REPO_INDEX.md current) → skip Agent 1, start at Agent 2
- Prior full run exists, no code changes since → skip to Agent 4 (or skip entirely)
- Code changed since last run → stale files get updated, downstream agents re-run

The orchestrator determines freshness by comparing the output file's last-modified time against `git log -1 --format="%ct"` (most recent commit timestamp). If the file is older than the last commit, it's stale.

To force a full rebuild, delete the output files or pass a "force" flag.

---

## Agent 1 — Repo Indexer

**Model**: Opus (or primary model)
**Output**: `REPO_INDEX.md`

### Prompt (full mode)

```
You are indexing a codebase for a test suite generation pipeline.

Create REPO_INDEX.md at the repo root that maps the entire codebase structure:

1. Read the project structure, entry points, configuration files, and key modules.
2. For each significant file, include: path, one-line description, key exports/endpoints/classes.
3. Identify: tech stack, frameworks, existing test tooling, how to run existing tests.
4. Note existing test files and what they cover.
5. Organize by module/feature area.

Skip: node_modules/, .git/, build/, dist/, __pycache__/, .dart_tool/, pods/, .gradle/, vendor/

6. **Existing test inventory**: Find ALL existing test files. For each, note:
   - File path
   - What module/feature it tests
   - Rough test count (number of test functions/methods)
   - Framework used (pytest, jest, flutter_test, etc.)
   - How to run them (e.g., `pytest tests/`, `flutter test`, `npm test`)
7. Run the existing tests and record pass/fail counts. This is the baseline.

This index will be consumed by downstream agents — be thorough and accurate.
```

### Prompt (update mode — when REPO_INDEX.md exists but is stale)

```
You are updating an existing codebase index for a test suite generation pipeline.

Read the existing REPO_INDEX.md at the repo root.
Then check what's changed since it was written:
- Run: git diff --name-status <last-indexed-commit>..HEAD (or git log --oneline -20 if the commit isn't known)
- For each added/modified/deleted file, update the index entry accordingly
- Add new files, update changed descriptions, remove deleted entries
- Don't rewrite entries that haven't changed

Update REPO_INDEX.md in place. Add a "Last updated" timestamp at the top.
```

---

## Agent 2 — Test Designer

**Model**: Opus (or primary model)
**Depends on**: Agent 1 (reads REPO_INDEX.md)
**Output**: `TEST_DESIGN.md`

### Prompt

```
Act as a Senior Staff Engineer specializing in reliability, QA architecture, and production hardening.

Your task is to design a comprehensive test plan for this codebase. Do NOT write test code yet.

## Step 1 — Read the Codebase

Read REPO_INDEX.md at the repo root for the full codebase map.
Then read the key source files it references — focus on entry points, API routes, core business logic, auth, data models, and configuration.
If a CLAUDE.md, README.md, or architecture doc exists, read that too.
Understand the system before designing tests.

## Step 2 — Functional Coverage Map

First, read the existing test inventory from REPO_INDEX.md. Understand what's already tested before identifying gaps.

Produce a coverage map identifying:
- Core user flows (the 5-10 things users actually do)
- Secondary flows (settings, edge features, admin)
- Failure paths (what happens when things break — network, DB, auth, external services)
- State transitions (lifecycle events, mode switches, session management)
- Security boundaries (auth, authorization, input validation, data isolation)
- Async/concurrency risks (race conditions, timeouts, queue behavior)
- Data boundaries (limits, types, encoding, null/empty handling)

## Step 3 — Test Design (Risk-Tiered)

Design tests across these layers, prioritized by risk:

**Tier 1 — Must have (ship blockers):**
- Auth and permission enforcement
- Core user flow happy paths
- Input validation and sanitization
- Data integrity (CRUD correctness, cascade deletes, foreign keys)
- Error handling (graceful failures, no data leaks in error responses)

**Tier 2 — Should have (production confidence):**
- Integration tests (module interactions, API contracts, DB consistency)
- Edge cases (boundary values, empty/null inputs, malformed data, extreme sizes)
- State transition correctness (mode switches, session lifecycle, concurrent access)
- External service failures (timeouts, retries, fallback behavior)

**Tier 3 — Nice to have (hardening):**
- Performance-sensitive paths under load
- Chaos/resilience (only if the stack supports fault injection)
- Regression tests for known fragile areas
- Long-running session/connection stability

For each test, include:
- Test name
- What it validates
- Tier (1/2/3)
- What production incident it prevents
- **NEW or EXISTING** — mark whether this test already exists in the codebase or needs to be written

Output a coverage summary at the end:
- What's already covered by existing tests (with file references)
- What's NOT covered (the gaps — this is what Agent 4 will write)
- What existing tests are weak/incomplete and should be strengthened

Write the full test design to TEST_DESIGN.md. Do NOT generate test code.
```

---

## Agent 3 — Architecture Review (Second Pass)

**Model**: Codex 5.3 (or secondary reviewer model)
**Depends on**: Agent 2 (reads TEST_DESIGN.md)
**Output**: `DESIGN_REVIEW.md`

### Prompt

```
You are a Principal Engineer and System Architect performing an independent review of a test design.

Read these files:
- REPO_INDEX.md (codebase map)
- TEST_DESIGN.md (proposed test plan from first-pass engineer)

Then read the key source files referenced in REPO_INDEX.md to verify the test design against actual code.

Your job:

1. **Gap analysis** — What's missing? What failure modes are untested?
2. **Edge case detection** — What weird inputs, states, or sequences would break things?
3. **Risk modeling** — What's the worst thing that could happen if this test suite passes but misses a bug?
4. **Redundancy check** — Are any tests duplicated or testing the same thing differently?
5. **Feasibility check** — Are any tests untestable with the current stack? Flag them.
6. **Priority corrections** — Are any Tier 2/3 tests actually Tier 1? Vice versa?

Add tests the first pass missed. Remove or downgrade weak tests. Strengthen coverage.

End with: "If this suite passes, would I be confident shipping to production?" — answer honestly.

Write your findings to DESIGN_REVIEW.md with:
- Tests to add (with tier and reasoning)
- Tests to remove or modify
- Gap analysis summary
- Confidence assessment
- Final recommended test list (merged with original design)
```

---

## Agent 4 — Test Generator + Runner

**Model**: Opus (or primary model)
**Depends on**: Agent 2 + Agent 3 (reads TEST_DESIGN.md + DESIGN_REVIEW.md)
**Output**: Test files + `TEST_REPORT.md`

### Prompt

```
Act as a Senior Staff Engineer. Your job is to generate and run a production-grade test suite.

Read these files:
- REPO_INDEX.md (codebase map)
- TEST_DESIGN.md (test plan)
- DESIGN_REVIEW.md (architecture review with additions/corrections)

Use the DESIGN_REVIEW.md final recommended test list as your source of truth — it incorporates both passes.

## Step 1 — Generate Executable Tests

- **Only write tests for gaps** — do NOT rewrite or duplicate tests that already exist and pass.
- If an existing test is weak or incomplete, extend it — don't replace it.
- Write real, runnable test code using the project's existing test framework and conventions.
- Follow the project's existing test file organization and naming patterns.
- Use inline comments for non-obvious test cases — skip boilerplate descriptions.
- Mock external dependencies (APIs, DBs, third-party services) appropriately.
- Generate Tier 1 gap tests first, then Tier 2, then Tier 3.
- Every test should answer: "What production incident does this prevent?"

Do NOT write test documentation templates. Write code that runs.

## DB Isolation (critical for any project with a database)

If the app uses a database, generate a conftest fixture that isolates each test:
- **Preferred**: Wrap each test in a transaction and roll it back after the test finishes. Override the app's session/dependency to use the test transaction.
- **Fallback**: Truncate all tables in a teardown fixture if rollback isn't feasible (e.g., tests that require committed data for multi-connection scenarios).
- Never rely on a shared DB session across tests — state WILL leak and cause cascade failures that pass in isolation but fail when run together.
- If the framework provides a built-in test DB pattern (e.g., Django's `TestCase`, Rails fixtures), use it.
- **SQLite test engines**: If using SQLite for tests (`:memory:` or file-based), strip production pool args (`pool_size`, `max_overflow`, `pool_timeout`, `pool_pre_ping`) — they're invalid for SQLite's `SingletonThreadPool` and will raise errors.

## Test Infrastructure Anti-Patterns (MUST READ)

These cause suites that pass individually but fail when run together. Agent 4 MUST avoid all of them.

### Never inject MagicMock into `sys.modules`
```python
# ❌ NEVER DO THIS — it's a time bomb
sys.modules['app.services.some_deleted_module'] = MagicMock()
```
FastAPI's dependency system calls `deepcopy()` on default parameter values. MagicMock objects can't be pickled or deepcopied. After ~65+ cumulative TestClient lifecycle cycles, `deepcopy` hits the MagicMock and crashes with `TypeError: cannot pickle 'module' object`. This failure is non-deterministic and only appears when running the full suite.

**Instead**: Use `unittest.mock.patch` at the import site, or create a minimal stub module with real classes/functions that are picklable:
```python
# ✅ Stub module — picklable, won't crash deepcopy
import types
stub = types.ModuleType('app.services.some_module')
stub.SomeClass = lambda *a, **kw: None  # minimal no-op
sys.modules['app.services.some_module'] = stub
```

### Noop lifespan for apps with startup side effects
If the app has a `lifespan` context manager (FastAPI) or `on_startup`/`on_shutdown` hooks that do real work (observability init, warmup, HTTP client creation, DB migrations), tests should override it with a no-op:
```python
@asynccontextmanager
async def _noop_lifespan(app):
    yield

app.router.lifespan_context = _noop_lifespan
```
This prevents tests from initializing production telemetry, making real HTTP connections, or running warmup queries.

### Reset stateful middleware between tests
Middleware that accumulates state (rate limiters, request counters, circuit breakers) will leak across tests. Either:
- Reset the middleware's internal state in an `autouse` fixture
- Disable rate limiting entirely in test mode via config
- Use per-test app instances (expensive but bulletproof)

Example:
```python
@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    from app.core.rate_limiter import RateLimitMiddleware
    yield
    RateLimitMiddleware.request_records.clear()  # or equivalent
```

### TestClient lifecycle budget
Each `TestClient(app)` context entry/exit runs the full ASGI lifespan cycle. After many cumulative cycles in one process, internal state can degrade. Prefer:
- One shared `TestClient` per test file (module-scoped fixture) when possible
- Session-scoped app fixture with function-scoped DB transactions inside it
- Avoid creating a new `TestClient` per test function unless necessary

## Step 2 — Run Tests

- Run all tests. Fix any that fail due to implementation errors in the tests themselves.
- Do NOT fix application code — only fix test code.
- If a test genuinely reveals a bug in the application, note it but don't fix the app.

## Step 3 — Report

Write TEST_REPORT.md with:

```
Existing tests:   [count, pass/fail baseline from Agent 1]
New tests written: [count by tier]
Total suite:      [existing + new]
Tests passing:    [count]
Tests failing:    [count + reason — distinguish test bugs from app bugs]
App bugs found:   [list any real bugs the tests uncovered]
Flaky risks:      [tests that depend on timing, order, or environment]
Coverage before:  [estimated % before this run]
Coverage after:   [estimated % after new tests added]
Confidence:       [1-10] with justification
Known gaps:       [list with risk assessment]
```

## Constraints

- Aim for 80% coverage of critical paths over 100% coverage of everything.
- Don't generate tests you can't run. If fault injection isn't available, skip chaos tests.
- If the suite exceeds what can be built in one session, generate Tier 1 fully and list Tier 2-3 as a follow-up plan.
- If tests take too long to run, run Tier 1 and spot-check Tier 2. Report what wasn't run.
- **Exclude stale tests**: If REPO_INDEX.md flags legacy/deprecated test files, add them to the `--ignore` list in pytest.ini / conftest. Don't let collection errors from dead code break the suite.
- **Run the full suite together, not just individual files**: Tests that pass in isolation but fail together are the most dangerous kind of bug. Always do a final full-suite run and fix cross-test interference before reporting results.
```

---

## Notes for the Orchestrator

- **Timeout**: Give each agent 10-15 minutes. Agent 4 may need more for large repos.
- **Model selection**: Agents 1, 2, 4 use the primary model (Opus). Agent 3 uses the secondary reviewer (Codex 5.3).
- **File handoff**: All agents write to the repo root. Each agent reads the previous agent's output file.
- **Existing tests**: Agent 4 should complement existing tests, not duplicate them.
- **Repo-specific context**: When invoking, pass the repo path. The orchestrator should tell each agent the exact file paths to read.
- **Freshness check**: Before each agent, compare its output file timestamp against `git log -1 --format="%ct"`. Skip if current, update if stale, full run if missing.
- **Incremental runs**: If artifacts exist from a prior run, only stale/missing stages re-run. To force everything fresh, delete the output files or say "force full run."
- **Update mode**: When an agent runs in update mode, it reads its own prior output and patches it — faster and cheaper than rebuilding. Downstream agents still re-run since their input changed.
