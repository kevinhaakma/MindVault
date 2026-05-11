# MindVault

Meet Vex.

Vex is a small, meticulous archivist who lives inside your terminal. He wears a green visor, keeps an absurdly organized card catalog, and gets visibly annoyed when people store API keys in places they shouldn't. His job is to remember things for code agents so they don't have to burn tokens re-learning the same project conventions every session. He files memories into constellations, draws lines between related thoughts, and keeps secrets locked in a vault he refuses to open in front of anyone.

This is his filing system.

---

## Architecture

```
mindvault/
├── backend/    FastAPI server — SQLite + FTS5 + LanceDB (port 8765)
├── mcp/        MCP server — exposes recall/remember/get_secret to agents
├── gui/        React + Cosmograph constellation viewer (port 5173)
└── scripts/    mindvault-run (secret env injector)
                mindvault-secret (keychain CLI)
```

**Three tiers of recall, working together:**

1. **Hot tier** — a small `CLAUDE.md` per project. Always loaded, no retrieval cost. Just a convention; no code required.
2. **Warm tier** — SQLite FTS5 keyword search. Microseconds, handles ~80% of agent queries. Vex checks this first.
3. **Cold tier** — LanceDB vector store with local BGE-small embeddings (384 dims via fastembed). Fallback when FTS comes up thin.

**The knowledge graph** sits on top of all three tiers. Edges form automatically from:
- Cosine similarity > 0.75 (semantic edges, drawn via kNN at write time)
- Temporal proximity — each new memory in a project edges the previous one
- Explicit `related_to` tags passed by the agent

**Secrets never enter the index.** `remember` scans content for secret-shaped strings before storing. Secrets live in your OS keychain via `keyring`. The `get_secret` MCP tool writes the value to a 0600-protected env file and returns only a confirmation — the raw value never enters model context or the GUI.

---

## Setup

### 1. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python server.py   # binds 127.0.0.1:8765
```

First run downloads BGE-small (~130 MB) into the fastembed cache. Data lives at `~/.mindvault/` — override with `MINDVAULT_DIR`.

### 2. MCP server

```bash
cd mcp
pip install -r requirements.txt
```

Add Vex to your MCP config (`~/.claude/claude_desktop_config.json` or a project `.mcp.json`):

```json
{
  "mcpServers": {
    "mindvault": {
      "command": "python",
      "args": ["/absolute/path/to/mindvault/mcp/server.py"]
    }
  }
}
```

Restart your MCP client. `recall`, `remember`, and `get_secret` should appear.

### 3. GUI

```bash
cd gui
npm install
npm run dev   # opens http://localhost:5173
```

### 4. Secrets (optional but recommended)

```bash
chmod +x scripts/mindvault-run scripts/mindvault-secret

# store a key
./scripts/mindvault-secret set OPENAI_KEY

# Vex can now retrieve it for agents — raw value never shown
# run commands that need it via the wrapper:
./scripts/mindvault-run python my_script.py   # $MINDVAULT_SECRET_OPENAI_KEY in env
```

Symlink both scripts into your `$PATH`.

---

## The CLAUDE.md snippet (hot tier)

Add this to your project's `CLAUDE.md` to introduce Vex to incoming agents:

```markdown
## Memory

You have persistent memory via Vex — a meticulous archivist running as an MCP server.
Vex remembers project conventions, past decisions, fixed bugs, and useful patterns
across sessions so you don't have to re-derive them.

- **Before starting any non-trivial task**, call `recall` with relevant keywords.
  It's cheap. If Vex has seen it before, he'll tell you. If not, you'll know in seconds.
- **After completing a meaningful task** — a fix, a decision, a learned convention —
  call `remember`. Keep entries 1–3 sentences, high-signal. Omit obvious things.
- **Never paste API keys** into `remember`. Vex will refuse, loudly. Store them with
  `mindvault-secret set <name>`, then use `get_secret` + `mindvault-run`.
- Use `kind` to classify: `episode` (what happened), `lesson` (what was learned),
  `decision` (why we chose X), `reference` (pointer to a resource or file).
```

---

## GUI: Vex's constellation view

The GUI shows Vex's archive as a force-directed graph of memory nodes. This is the debugger — when retrieval misbehaves, you can see the bad cluster and prune it.

**Sidebar controls:**
- **Project filter** — scope the view to one project's constellation
- **Time window slider** — filter by `created_at` percentile; slide left to hide old memories
- **View mode** — color by `kind` (episode/lesson/decision/reference) or by heat (recall frequency)
- **Refresh** — pull latest graph state from the backend
- **Prune orphans** — delete nodes with no edges and zero recalls (likely junk)

**Canvas:**
- Nodes positioned by PCA of their embedding vectors (deterministic, fast)
- Node size scales with `√(access_count)` — hot memories are visually larger
- Edge color and width reflect kind and weight

**Click a node** to see a detail card: kind, 140-char preview, project, recall count, filed timestamp, delete button.

**Vex avatar** (bottom of sidebar) reacts to state:
- Thumbs-up when the archive loads with data
- Frown when the current view is empty
- Neutral otherwise

---

## Security notes

- **Backend binds `127.0.0.1` only.** Do not expose it over a network interface. There is no auth.
- **SQLite and LanceDB files are unencrypted** at `~/.mindvault/`. Standard user filesystem permissions apply. If your machine has full-disk encryption (FileVault, BitLocker, LUKS), laptop-loss threats are covered. If you need encryption-at-rest beyond that, layer it on yourself.
- **`~/.mindvault/session.env` is chmod 0600** and contains plaintext secrets only for the duration of an active session. Wipe it when done: `rm ~/.mindvault/session.env`.
- **The secret-pattern regex is a safety net, not a guarantee.** It catches common well-known token formats (OpenAI `sk-`, Anthropic `sk-ant-`, GitHub `ghp_`, AWS `AKIA`, Google `AIza`, Slack `xox*`, PEM blocks, JWTs). Custom or non-standard tokens won't be caught. Don't paste secrets into agent messages and expect the regex to save you.
- **Secrets never appear in MCP tool responses or GUI output.** The raw value is written to `session.env` and the model receives only a confirmation string.

---

## Roadmap

- **Tauri wrapper** — package the GUI as a real desktop app, drop the dev server dependency.
- **Auto-compaction agent** — weekly job that LLM-summarizes old `episode` memories into `lesson` entries and removes the originals, keeping the index small.
- **Retrieval replay log** — record which node IDs each `recall` call returns so you can debug retrieval quality after the fact.
- **JSONL sync** — append-only log + git transport so Vex follows you across machines.
- **Per-project encryption** — passphrase-derived key for the SQLite/Lance store, for shared team setups.
