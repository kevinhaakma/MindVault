"""
MindVault backend — vector memory + knowledge graph for code agents.

Three-tier memory:
  hot  — tiny CLAUDE.md per project (agent layer, not here)
  warm — SQLite FTS5 keyword search (microseconds, ~80% of queries)
  cold — SQLite BLOB vectors + numpy cosine sim (semantic fallback)

Vectors stored as float32 BLOBs in SQLite — no lancedb/rust required.
fastembed is optional: if onnxruntime crashes, falls back to keyword-only.
"""
import hashlib
import hmac
import logging
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import APIRouter, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("mindvault")

# --- config ---
DATA_DIR = Path(os.environ.get("MINDVAULT_DIR", Path.home() / ".mindvault"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
SQLITE_PATH = DATA_DIR / "graph.db"
EMBED_MODEL = "BAAI/bge-small-en-v1.5"
EMBED_DIM = 384
SIM_EDGE_THRESHOLD       = 0.75   # within same project
SIM_EDGE_CROSS_THRESHOLD = 0.85   # across projects (higher bar — must be strongly related)

os.environ.setdefault("FASTEMBED_CACHE_PATH", str(DATA_DIR / ".cache"))

# --- secret patterns ---
SECRET_PATTERNS = [
    (re.compile(r"sk-[a-zA-Z0-9]{20,}"),                                        "OpenAI/Anthropic key (sk-)"),
    (re.compile(r"sk-ant-[a-zA-Z0-9\-_]{20,}"),                                 "Anthropic key (sk-ant-)"),
    (re.compile(r"ghp_[a-zA-Z0-9]{20,}"),                                       "GitHub PAT (ghp_)"),
    (re.compile(r"AKIA[0-9A-Z]{16}"),                                           "AWS access key (AKIA)"),
    (re.compile(r"AIza[0-9A-Za-z\-_]{35}"),                                     "Google API key (AIza)"),
    (re.compile(r"xox[baprs]-[a-zA-Z0-9\-]{10,}"),                              "Slack token (xox*)"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),                         "PEM private key block"),
    (re.compile(r"eyJ[a-zA-Z0-9_\-]+\.eyJ[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+"), "JWT"),
]


def contains_secret(text: str) -> Optional[str]:
    for pat, name in SECRET_PATTERNS:
        if pat.search(text):
            return name
    return None


# --- lazy globals ---
_embedder = None
_embed_available: Optional[bool] = None  # None=untested, True=ok, False=broken
sql: Optional[sqlite3.Connection] = None
_init_error: Optional[str] = None


def embed(texts: list[str]) -> Optional[np.ndarray]:
    global _embedder, _embed_available
    if _embed_available is False:
        return None
    try:
        if _embedder is None:
            from fastembed import TextEmbedding
            log.info("Loading embedding model %s ...", EMBED_MODEL)
            _embedder = TextEmbedding(model_name=EMBED_MODEL)
            log.info("Embedding model ready.")
            _embed_available = True
        return np.array(list(_embedder.embed(texts)), dtype=np.float32)
    except Exception as exc:
        log.error("Embedding failed, disabling semantic search: %s", exc)
        _embed_available = False
        return None


# --- storage ---
BACKUP_DIR  = DATA_DIR / "backups"
BACKUP_KEEP = 14         # daily backups retained
BACKUP_INTERVAL = 86400  # seconds


def _init_sqlite() -> sqlite3.Connection:
    conn = sqlite3.connect(str(SQLITE_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # WAL so backups can run while writes happen
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS memories (
            id           TEXT PRIMARY KEY,
            content      TEXT NOT NULL,
            project      TEXT NOT NULL,
            kind         TEXT NOT NULL,
            tags         TEXT,
            created_at   REAL NOT NULL,
            access_count INTEGER DEFAULT 0,
            last_accessed REAL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
            content, tags, project,
            content='memories', content_rowid='rowid'
        );
        CREATE TABLE IF NOT EXISTS vectors (
            id     TEXT PRIMARY KEY,
            vector BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS edges (
            src    TEXT NOT NULL,
            dst    TEXT NOT NULL,
            kind   TEXT NOT NULL,
            weight REAL NOT NULL,
            PRIMARY KEY (src, dst, kind)
        );
        CREATE INDEX IF NOT EXISTS idx_edges_src     ON edges(src);
        CREATE INDEX IF NOT EXISTS idx_memories_proj ON memories(project);
        CREATE INDEX IF NOT EXISTS idx_memories_time ON memories(created_at);

        -- Knowledge layer: shared entities + typed triples
        CREATE TABLE IF NOT EXISTS entities (
            id            TEXT PRIMARY KEY,
            name          TEXT NOT NULL,
            canonical     TEXT NOT NULL UNIQUE,
            kind          TEXT,
            mention_count INTEGER DEFAULT 0,
            created_at    REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS triples (
            subj_id          TEXT NOT NULL,
            predicate        TEXT NOT NULL,
            obj_id           TEXT,
            obj_literal      TEXT,
            weight           REAL DEFAULT 1.0,
            source_memory_id TEXT,
            created_at       REAL NOT NULL,
            PRIMARY KEY (subj_id, predicate, obj_id, obj_literal)
        );
        CREATE INDEX IF NOT EXISTS idx_triples_subj ON triples(subj_id);
        CREATE INDEX IF NOT EXISTS idx_triples_obj  ON triples(obj_id);
        CREATE INDEX IF NOT EXISTS idx_entities_canon ON entities(canonical);
        CREATE INDEX IF NOT EXISTS idx_entities_kind  ON entities(kind);
    """)
    conn.commit()
    return conn


# --- app ---
app    = FastAPI(title="MindVault")
router = APIRouter()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    global sql, _init_error
    try:
        log.info("Initialising SQLite at %s", SQLITE_PATH)
        sql = _init_sqlite()
        log.info("SQLite ready.")
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        threading.Thread(target=_backup_worker, daemon=True).start()
        log.info("Backup worker started — daily snapshots to %s", BACKUP_DIR)
    except Exception as exc:
        _init_error = f"SQLite init failed: {exc}"
        log.error(_init_error)


# --- backup ---
def _do_backup() -> dict:
    """Atomic SQLite snapshot. Safe to run while writes are in progress (WAL)."""
    if sql is None:
        raise RuntimeError("sql not initialised")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    dst = BACKUP_DIR / f"graph-{ts}.db"
    dst_conn = sqlite3.connect(str(dst))
    try:
        sql.backup(dst_conn)
    finally:
        dst_conn.close()
    # prune
    backups = sorted(BACKUP_DIR.glob("graph-*.db"))
    pruned = []
    for old in backups[:-BACKUP_KEEP]:
        try:
            old.unlink()
            pruned.append(old.name)
        except Exception:
            pass
    return {
        "name": dst.name,
        "size": dst.stat().st_size,
        "timestamp": ts,
        "pruned": pruned,
        "kept": min(len(backups), BACKUP_KEEP),
    }


def _backup_worker():
    """Daily snapshot loop. First snapshot 5 min after boot."""
    time.sleep(300)
    while True:
        try:
            r = _do_backup()
            log.info("daily backup: %s (%d bytes, pruned %d, kept %d)",
                     r["name"], r["size"], len(r["pruned"]), r["kept"])
        except Exception as exc:
            log.error("backup failed: %s", exc)
        time.sleep(BACKUP_INTERVAL)


def _require_db():
    if sql is None:
        raise HTTPException(503, f"Storage not ready. {_init_error or 'Initialising...'}")


@contextmanager
def tx():
    try:
        yield sql
        sql.commit()
    except Exception:
        sql.rollback()
        raise


# --- request models ---
class WriteRequest(BaseModel):
    content:    str
    project:    str       = "default"
    kind:       str       = "episode"
    tags:       list[str] = []
    related_to: list[str] = []


class RecallRequest(BaseModel):
    query:             str
    project:           Optional[str] = None
    limit:             int           = 5
    mode:              str           = "auto"   # auto|keyword|semantic|smart
    include_neighbors: bool          = False    # expand top hits with 1-hop edges


# --- vector helpers (pure SQLite + numpy, no lancedb) ---
def _store_vector(mem_id: str, vec: np.ndarray):
    sql.execute(
        "INSERT OR REPLACE INTO vectors (id, vector) VALUES (?, ?)",
        (mem_id, vec.astype(np.float32).tobytes()),
    )


def _cosine_search(query_vec: np.ndarray, project: Optional[str], limit: int) -> list[dict]:
    if project:
        ids = [r[0] for r in sql.execute(
            "SELECT id FROM memories WHERE project = ?", (project,)
        ).fetchall()]
    else:
        ids = [r[0] for r in sql.execute("SELECT id FROM memories").fetchall()]

    if not ids:
        return []

    placeholders = ",".join("?" * len(ids))
    rows = sql.execute(
        f"SELECT id, vector FROM vectors WHERE id IN ({placeholders})", ids
    ).fetchall()

    sims = []
    for row in rows:
        vec = np.frombuffer(row["vector"], dtype=np.float32)
        sim = float(np.dot(query_vec, vec))
        sims.append((row["id"], sim))

    sims.sort(key=lambda x: -x[1])
    return [{"id": mid, "score": s} for mid, s in sims[:limit]]


# --- graph helpers ---
def _add_edge(src: str, dst: str, kind: str, weight: float):
    if src == dst:
        return
    sql.execute(
        "INSERT OR REPLACE INTO edges (src, dst, kind, weight) VALUES (?, ?, ?, ?)",
        (src, dst, kind, weight),
    )


def _auto_link(mem_id: str, vec: np.ndarray, project: str):
    """Link to similar memories — semantic (same project) and cross-project (higher bar)."""
    neighbors = _cosine_search(vec, None, 16)  # search globally
    for n in neighbors:
        if n["id"] == mem_id:
            continue
        row = sql.execute("SELECT project FROM memories WHERE id = ?", (n["id"],)).fetchone()
        if not row:
            continue
        same = row["project"] == project
        threshold = SIM_EDGE_THRESHOLD if same else SIM_EDGE_CROSS_THRESHOLD
        if n["score"] >= threshold:
            kind = "semantic" if same else "cross"
            _add_edge(mem_id, n["id"], kind, n["score"])
            _add_edge(n["id"], mem_id, kind, n["score"])


# --- routes ---
VERSION = "0.1.29"


@router.get("/health")
def health():
    return {
        "status": "ok" if sql else "initialising",
        "embed": _embed_available,
        "error": _init_error,
        "version": VERSION,
    }


@router.get("/version")
def version():
    return {"version": VERSION}


# ── auth ─────────────────────────────────────────────────────────────────────
_AUTH_PASSWORD = os.environ.get("MINDVAULT_PASSWORD", "").strip()
_AUTH_SECRET   = os.environ.get("MINDVAULT_SECRET", "").strip() or secrets.token_hex(32)
_SESSION_TTL   = 30 * 86400  # 30 days
_AUTH_PASSWORD_HASH = hashlib.sha256(_AUTH_PASSWORD.encode()).hexdigest() if _AUTH_PASSWORD else ""


def _sign(payload: str) -> str:
    return hmac.new(_AUTH_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _make_token() -> str:
    ts = str(int(time.time()))
    payload = f"{ts}.{_AUTH_PASSWORD_HASH}"
    return f"{payload}.{_sign(payload)}"


def _verify_token(token: str) -> bool:
    if not _AUTH_PASSWORD:
        return True
    if not token:
        return False
    try:
        ts_str, ph, sig = token.split(".", 2)
        if not hmac.compare_digest(_sign(f"{ts_str}.{ph}"), sig):
            return False
        if int(ts_str) + _SESSION_TTL < time.time():
            return False
        if ph != _AUTH_PASSWORD_HASH:
            return False
        return True
    except Exception:
        return False


class LoginRequest(BaseModel):
    password: str


@router.post("/login")
def login(req: LoginRequest, response: Response):
    if not _AUTH_PASSWORD:
        return {"ok": True, "auth_required": False}
    # constant-time compare
    if not hmac.compare_digest(req.password, _AUTH_PASSWORD):
        raise HTTPException(401, "Wrong password")
    token = _make_token()
    response.set_cookie(
        "vex_session", token,
        max_age=_SESSION_TTL,
        httponly=True,
        samesite="lax",
        secure=False,   # nginx terminates TLS — cookie travels http inside docker net
        path="/",
    )
    return {"ok": True}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("vex_session", path="/")
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    if not _AUTH_PASSWORD:
        return {"authenticated": True, "auth_required": False}
    token = request.cookies.get("vex_session", "")
    return {"authenticated": _verify_token(token), "auth_required": True}


# Public API routes that work without auth (login flow + meta)
_PUBLIC_API = {
    "/login", "/logout", "/me", "/health", "/version",
    "/api/login", "/api/logout", "/api/me", "/api/health", "/api/version",
}


@app.middleware("http")
async def _auth_middleware(request: Request, call_next):
    if not _AUTH_PASSWORD:
        return await call_next(request)
    path = request.url.path
    # Only gate API routes — static SPA must load so the login screen can render
    is_api = path.startswith("/api/") or path in _PUBLIC_API or path in {
        "/write", "/recall", "/graph", "/stats", "/backup", "/backups",
        "/relink", "/prune-orphans",
    }
    if not is_api:
        return await call_next(request)
    if path in _PUBLIC_API:
        return await call_next(request)
    # Supervisor passthrough always allowed: it has its own supervisor-token guard
    # and is only useful for trusted callers on Tailscale.
    if path.startswith("/api/supervisor/") or path.startswith("/supervisor/"):
        return await call_next(request)
    token = request.cookies.get("vex_session", "")
    if not _verify_token(token):
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    return await call_next(request)


# ── supervisor passthrough (requires hassio_api: true in config.yaml) ────────
import json as _json
from urllib.request import Request as _Req, urlopen as _urlopen
from urllib.error  import HTTPError as _HTTPError

_SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN")
_SUPERVISOR_BASE  = "http://supervisor"


def _sup(method: str, path: str, body: Optional[dict] = None) -> dict:
    if not _SUPERVISOR_TOKEN:
        raise HTTPException(503, "Supervisor token not available (hassio_api off?)")
    url = f"{_SUPERVISOR_BASE}{path}"
    data = _json.dumps(body).encode() if body is not None else None
    req = _Req(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {_SUPERVISOR_TOKEN}")
    req.add_header("Content-Type", "application/json")
    try:
        with _urlopen(req, timeout=30) as r:
            return _json.loads(r.read())
    except _HTTPError as e:
        return {"error": e.read().decode(errors="ignore"), "status": e.code}


@router.get("/supervisor/addons")
def sup_addons():
    return _sup("GET", "/addons")


@router.get("/supervisor/addons/{slug}/info")
def sup_addon_info(slug: str):
    return _sup("GET", f"/addons/{slug}/info")


class SupOptions(BaseModel):
    options: dict


@router.post("/supervisor/addons/{slug}/options")
def sup_addon_options(slug: str, req: SupOptions):
    return _sup("POST", f"/addons/{slug}/options", {"options": req.options})


@router.post("/supervisor/addons/{slug}/restart")
def sup_addon_restart(slug: str):
    return _sup("POST", f"/addons/{slug}/restart")


@router.post("/supervisor/addons/{slug}/start")
def sup_addon_start(slug: str):
    return _sup("POST", f"/addons/{slug}/start")


@router.post("/backup")
def backup_now():
    _require_db()
    try:
        return _do_backup()
    except Exception as exc:
        raise HTTPException(500, f"Backup failed: {exc}")


@router.get("/backups")
def list_backups():
    if not BACKUP_DIR.exists():
        return {"backups": [], "dir": str(BACKUP_DIR)}
    items = []
    for p in sorted(BACKUP_DIR.glob("graph-*.db"), reverse=True):
        st = p.stat()
        items.append({"name": p.name, "size": st.st_size, "mtime": st.st_mtime})
    return {"backups": items, "dir": str(BACKUP_DIR), "keep": BACKUP_KEEP}


@router.post("/write")
def write(req: WriteRequest):
    _require_db()
    leak = contains_secret(req.content)
    if leak:
        raise HTTPException(
            400,
            f"Vex refuses to file this. Content contains a secret-shaped string ({leak}).",
        )

    mem_id   = str(uuid.uuid4())
    now      = time.time()
    tags_str = ",".join(req.tags)

    with tx() as c:
        c.execute(
            "INSERT INTO memories (id, content, project, kind, tags, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (mem_id, req.content, req.project, req.kind, tags_str, now),
        )
        c.execute(
            "INSERT INTO memories_fts (rowid, content, tags, project) "
            "SELECT rowid, content, tags, project FROM memories WHERE id = ?",
            (mem_id,),
        )
        for other_id in req.related_to:
            _add_edge(mem_id, other_id, "explicit", 1.0)
            _add_edge(other_id, mem_id, "explicit", 1.0)

        prev = c.execute(
            "SELECT id FROM memories WHERE project = ? AND id != ? "
            "ORDER BY created_at DESC LIMIT 1",
            (req.project, mem_id),
        ).fetchone()
        if prev:
            _add_edge(prev["id"], mem_id, "temporal", 0.3)

    vecs = embed([req.content])
    if vecs is not None:
        v = vecs[0]
        v = v / (np.linalg.norm(v) + 1e-9)
        with tx():
            _store_vector(mem_id, v)
        sql.commit()
        _auto_link(mem_id, v, req.project)

    return {"id": mem_id, "created_at": now}


def _fts_search(query: str, project: Optional[str], limit: int) -> dict:
    """Returns {id: (row_dict, bm25_score)}. Lower bm25 = better in SQLite, we negate."""
    proj_filter = "AND m.project = ?" if project else ""
    params: list = [query]
    if project: params.append(project)
    params.append(limit)
    try:
        rows = sql.execute(
            f"""SELECT m.id, m.content, m.project, m.kind, m.tags, m.created_at, m.access_count,
                       bm25(memories_fts) AS bm
                FROM memories_fts
                JOIN memories m ON m.rowid = memories_fts.rowid
                WHERE memories_fts MATCH ? {proj_filter}
                ORDER BY bm LIMIT ?""",
            params,
        ).fetchall()
    except sqlite3.OperationalError:
        # FTS5 syntax error (e.g. special chars in query) — fall back to LIKE
        like = f"%{query}%"
        params = [like, like]
        if project:
            params.append(project)
        params.append(limit)
        rows = sql.execute(
            f"""SELECT id, content, project, kind, tags, created_at, access_count, 0.0 AS bm
                FROM memories
                WHERE (content LIKE ? OR tags LIKE ?) {('AND project = ?' if project else '')}
                ORDER BY created_at DESC LIMIT ?""",
            params,
        ).fetchall()
    out = {}
    for r in rows:
        d = dict(r); bm = d.pop("bm", 0.0)
        out[d["id"]] = (d, -float(bm))   # higher = better
    return out


def _semantic_search(query: str, project: Optional[str], limit: int) -> dict:
    """Returns {id: cosine_score}."""
    qvecs = embed([query])
    if qvecs is None:
        return {}
    qv = qvecs[0]
    qv = qv / (np.linalg.norm(qv) + 1e-9)
    return {h["id"]: h["score"] for h in _cosine_search(qv, project, limit)}


def _fetch_row(mid: str) -> Optional[dict]:
    row = sql.execute(
        "SELECT id, content, project, kind, tags, created_at, access_count FROM memories WHERE id = ?",
        (mid,),
    ).fetchone()
    return dict(row) if row else None


def _expand_neighbors(seed_ids: list[str], limit: int, exclude: set) -> list[dict]:
    """1-hop edge expansion. Returns added rows ordered by edge weight."""
    if not seed_ids: return []
    placeholders = ",".join("?" * len(seed_ids))
    edges = sql.execute(
        f"""SELECT dst, MAX(weight) AS w
            FROM edges WHERE src IN ({placeholders})
            GROUP BY dst ORDER BY w DESC LIMIT ?""",
        seed_ids + [limit * 3],
    ).fetchall()
    out = []
    for e in edges:
        if e["dst"] in exclude: continue
        row = _fetch_row(e["dst"])
        if row:
            row["score"] = float(e["w"])
            row["via"]   = "neighbor"
            out.append(row)
            exclude.add(e["dst"])
        if len(out) >= limit: break
    return out


@router.post("/recall")
def recall(req: RecallRequest):
    _require_db()
    now = time.time()

    # ── fetch from both indexes ─────────────────────────────────────────────
    over_fetch = max(req.limit * 3, 12)
    fts_map = {}  # id → (row, score)
    sem_map = {}  # id → score

    if req.mode in ("auto", "keyword", "smart"):
        fts_map = _fts_search(req.query, req.project, over_fetch)
    if req.mode in ("auto", "semantic", "smart") or (req.mode == "auto" and len(fts_map) < req.limit):
        sem_map = _semantic_search(req.query, req.project, over_fetch)

    # ── hybrid scoring ──────────────────────────────────────────────────────
    # Normalize FTS scores per-call (relative ranking only matters)
    if fts_map:
        max_fts = max(s for _, s in fts_map.values()) or 1.0
        fts_norm = {mid: max(0.0, s / max_fts) for mid, (_, s) in fts_map.items()}
    else:
        fts_norm = {}

    all_ids = set(fts_map) | set(sem_map)
    scored: list[dict] = []
    for mid in all_ids:
        row = fts_map[mid][0] if mid in fts_map else _fetch_row(mid)
        if not row: continue
        f = fts_norm.get(mid, 0.0)         # 0..1
        s = sem_map.get(mid, 0.0)          # cosine, typically 0..1
        # take max of two retrieval signals (either route can prove relevance)
        relevance = max(f * 0.85, s)
        # 365-day exponential recency decay
        age_days = (now - row["created_at"]) / 86400
        recency  = 2.71828 ** (-age_days / 365)
        # mild access boost (capped)
        access   = 1.0 + min((row.get("access_count") or 0) / 20.0, 0.5)
        final    = relevance * (0.65 + 0.35 * recency) * access
        row["score"]     = round(final, 4)
        row["_fts"]      = round(f, 4)
        row["_sem"]      = round(s, 4)
        row["_recency"]  = round(recency, 4)
        scored.append(row)

    scored.sort(key=lambda r: -r["score"])
    results = scored[:req.limit]

    # ── optional 1-hop neighbor expansion ───────────────────────────────────
    if req.include_neighbors and results:
        seen = {r["id"] for r in results}
        top_seeds = [r["id"] for r in results[:3]]
        neighbors = _expand_neighbors(top_seeds, req.limit, seen)
        results.extend(neighbors)

    # ── update access stats ─────────────────────────────────────────────────
    for r in results:
        sql.execute(
            "UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?",
            (now, r["id"]),
        )
    sql.commit()
    return {"results": results}


@router.get("/graph")
def graph(project: Optional[str] = None, limit: int = 1000):
    _require_db()
    where  = "WHERE project = ?" if project else ""
    params = ([project] if project else []) + [limit]
    rows   = sql.execute(
        f"SELECT id, content, project, kind, tags, created_at, access_count "
        f"FROM memories {where} ORDER BY created_at DESC LIMIT ?",
        params,
    ).fetchall()
    nodes = [dict(r) for r in rows]
    if not nodes:
        return {"nodes": [], "edges": []}

    ids = [n["id"] for n in nodes]
    coord_by_id: dict[str, list[float]] = {}

    if len(ids) >= 3:
        try:
            from sklearn.decomposition import PCA
            placeholders = ",".join("?" * len(ids))
            vec_rows = sql.execute(
                f"SELECT id, vector FROM vectors WHERE id IN ({placeholders})", ids
            ).fetchall()
            if len(vec_rows) >= 3:
                vec_ids = [r["id"] for r in vec_rows]
                vecs    = np.stack([np.frombuffer(r["vector"], dtype=np.float32) for r in vec_rows])
                coords  = PCA(n_components=2).fit_transform(vecs)
                coords  = coords / (np.abs(coords).max() + 1e-9)
                coord_by_id = {i: c.tolist() for i, c in zip(vec_ids, coords)}
        except Exception as exc:
            log.warning("PCA layout failed: %s", exc)

    for n in nodes:
        n["x"], n["y"] = coord_by_id.get(n["id"], [0.0, 0.0])
        n["preview"]   = n["content"][:140]
        del n["content"]

    id_list   = ",".join(f"'{i}'" for i in ids)
    edge_rows = sql.execute(
        f"SELECT src, dst, kind, weight FROM edges WHERE src IN ({id_list})"
    ).fetchall()

    return {"nodes": nodes, "edges": [dict(e) for e in edge_rows]}


@router.get("/memory/{mem_id}")
def get_memory(mem_id: str):
    _require_db()
    row = sql.execute("SELECT * FROM memories WHERE id = ?", (mem_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Vex has no record of that id.")
    return dict(row)


@router.delete("/memory/{mem_id}")
def delete_memory(mem_id: str):
    _require_db()
    with tx() as c:
        rowid_row = c.execute(
            "SELECT rowid FROM memories WHERE id = ?", (mem_id,)
        ).fetchone()
        if rowid_row:
            c.execute("DELETE FROM memories_fts WHERE rowid = ?", (rowid_row[0],))
        c.execute("DELETE FROM memories WHERE id = ?", (mem_id,))
        c.execute("DELETE FROM edges WHERE src = ? OR dst = ?", (mem_id, mem_id))
        c.execute("DELETE FROM vectors WHERE id = ?", (mem_id,))
    return {"deleted": mem_id}


# ── Knowledge graph: entities + triples ─────────────────────────────────────
def _canonical(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"\s+", " ", s)
    return s


def _upsert_entity(name: str, kind: Optional[str] = None) -> str:
    canon = _canonical(name)
    if not canon:
        raise ValueError("empty name")
    row = sql.execute("SELECT id, kind FROM entities WHERE canonical = ?", (canon,)).fetchone()
    if row:
        eid = row["id"]
        # backfill kind if missing
        if kind and not row["kind"]:
            sql.execute("UPDATE entities SET kind = ? WHERE id = ?", (kind, eid))
        sql.execute("UPDATE entities SET mention_count = mention_count + 1 WHERE id = ?", (eid,))
        return eid
    eid = str(uuid.uuid4())
    sql.execute(
        "INSERT INTO entities (id, name, canonical, kind, mention_count, created_at) "
        "VALUES (?, ?, ?, ?, 1, ?)",
        (eid, name.strip(), canon, kind, time.time()),
    )
    return eid


class EntityIn(BaseModel):
    name: str
    kind: Optional[str] = None


class TripleIn(BaseModel):
    subject:   str
    predicate: str
    object:    Optional[str] = None         # entity name OR literal
    object_kind: Optional[str] = None       # if object is an entity, hint its kind
    literal:   bool = False                 # if True, treat object as raw literal
    source_memory_id: Optional[str] = None
    weight:    float = 1.0


class ExtractIn(BaseModel):
    entities: list[EntityIn] = []
    relations: list[TripleIn] = []


@router.post("/entities")
def upsert_entity_route(req: EntityIn):
    _require_db()
    with tx():
        eid = _upsert_entity(req.name, req.kind)
    return {"id": eid, "canonical": _canonical(req.name)}


@router.get("/entities")
def list_entities(kind: Optional[str] = None, limit: int = 500):
    _require_db()
    if kind:
        rows = sql.execute(
            "SELECT id, name, canonical, kind, mention_count, created_at "
            "FROM entities WHERE kind = ? ORDER BY mention_count DESC LIMIT ?",
            (kind, limit),
        ).fetchall()
    else:
        rows = sql.execute(
            "SELECT id, name, canonical, kind, mention_count, created_at "
            "FROM entities ORDER BY mention_count DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return {"entities": [dict(r) for r in rows]}


@router.post("/triples")
def add_triple_route(req: TripleIn):
    _require_db()
    with tx():
        subj_id = _upsert_entity(req.subject)
        if req.literal or req.object is None:
            obj_id = None
            obj_literal = req.object
        else:
            obj_id = _upsert_entity(req.object, req.object_kind)
            obj_literal = None
        sql.execute(
            "INSERT OR REPLACE INTO triples "
            "(subj_id, predicate, obj_id, obj_literal, weight, source_memory_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (subj_id, req.predicate, obj_id, obj_literal,
             req.weight, req.source_memory_id, time.time()),
        )
    return {"ok": True, "subj_id": subj_id, "obj_id": obj_id}


@router.post("/memory/{mem_id}/extract")
def memory_extract(mem_id: str, req: ExtractIn):
    """Agent-supplied entity + relation extraction for a memory."""
    _require_db()
    if not sql.execute("SELECT id FROM memories WHERE id = ?", (mem_id,)).fetchone():
        raise HTTPException(404, "memory not found")
    added_entities = 0
    added_triples  = 0
    with tx():
        for e in req.entities:
            _upsert_entity(e.name, e.kind)
            added_entities += 1
        for t in req.relations:
            subj_id = _upsert_entity(t.subject)
            if t.literal or t.object is None:
                obj_id = None
                obj_literal = t.object
            else:
                obj_id = _upsert_entity(t.object, t.object_kind)
                obj_literal = None
            sql.execute(
                "INSERT OR REPLACE INTO triples "
                "(subj_id, predicate, obj_id, obj_literal, weight, source_memory_id, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (subj_id, t.predicate, obj_id, obj_literal,
                 t.weight, mem_id, time.time()),
            )
            added_triples += 1
    return {"entities": added_entities, "triples": added_triples}


@router.get("/knowledge")
def knowledge_graph(kind: Optional[str] = None, limit: int = 1000):
    """Returns entity-centric graph: nodes are entities, edges are predicates."""
    _require_db()
    if kind:
        ent_rows = sql.execute(
            "SELECT id, name, canonical, kind, mention_count, created_at "
            "FROM entities WHERE kind = ? ORDER BY mention_count DESC LIMIT ?",
            (kind, limit),
        ).fetchall()
    else:
        ent_rows = sql.execute(
            "SELECT id, name, canonical, kind, mention_count, created_at "
            "FROM entities ORDER BY mention_count DESC LIMIT ?",
            (limit,),
        ).fetchall()

    ids = [r["id"] for r in ent_rows]
    nodes = []
    coord_by_id: dict[str, list[float]] = {}

    # Use mention_count for size; layout by simple circular spread or PCA on co-occurrence (skipped — frontend does sim)
    for n in ent_rows:
        d = dict(n)
        d["x"] = 0.0
        d["y"] = 0.0
        nodes.append(d)

    if not ids:
        return {"nodes": [], "edges": []}

    placeholders = ",".join("?" * len(ids))
    triple_rows = sql.execute(
        f"SELECT subj_id, predicate, obj_id, obj_literal, weight "
        f"FROM triples WHERE subj_id IN ({placeholders}) "
        f"  AND (obj_id IS NULL OR obj_id IN ({placeholders}))",
        ids + ids,
    ).fetchall()

    edges = []
    for t in triple_rows:
        if not t["obj_id"]:
            continue   # skip literal-targets in graph view (still queryable elsewhere)
        edges.append({
            "src":       t["subj_id"],
            "dst":       t["obj_id"],
            "predicate": t["predicate"],
            "kind":      "triple",
            "weight":    t["weight"],
        })

    return {"nodes": nodes, "edges": edges}


@router.post("/relink")
def relink():
    """Re-run auto-link over all memories. Use after threshold changes or
    when introducing cross-project edges to existing data."""
    _require_db()
    rows = sql.execute("SELECT id, project FROM memories").fetchall()
    relinked = 0
    for r in rows:
        vrow = sql.execute("SELECT vector FROM vectors WHERE id = ?", (r["id"],)).fetchone()
        if not vrow:
            continue
        vec = np.frombuffer(vrow["vector"], dtype=np.float32)
        _auto_link(r["id"], vec, r["project"])
        relinked += 1
    sql.commit()
    counts = {row["kind"]: row["c"] for row in sql.execute(
        "SELECT kind, COUNT(*) AS c FROM edges GROUP BY kind"
    ).fetchall()}
    return {"relinked": relinked, "edges_by_kind": counts}


@router.post("/prune-orphans")
def prune_orphans(project: Optional[str] = None):
    _require_db()
    where  = "AND project = ?" if project else ""
    params = [project] if project else []
    rows   = sql.execute(
        f"""SELECT m.id FROM memories m
            LEFT JOIN edges e ON e.src = m.id
            WHERE e.src IS NULL AND m.access_count = 0 {where}""",
        params,
    ).fetchall()
    deleted = [r["id"] for r in rows]
    for mid in deleted:
        delete_memory(mid)
    return {"deleted": deleted, "count": len(deleted)}


@router.get("/stats")
def stats():
    _require_db()
    total    = sql.execute("SELECT COUNT(*) as c FROM memories").fetchone()["c"]
    edge_ct  = sql.execute("SELECT COUNT(*) as c FROM edges").fetchone()["c"]
    projects = [dict(r) for r in sql.execute(
        "SELECT project, COUNT(*) as count FROM memories GROUP BY project ORDER BY count DESC"
    ).fetchall()]
    return {"memories": total, "edges": edge_ct, "projects": projects}


# Mount at both / (dev proxy) and /api/ (production)
app.include_router(router)
app.include_router(router, prefix="/api")

# Static GUI
STATIC_DIR = os.environ.get("MINDVAULT_STATIC")
if STATIC_DIR and Path(STATIC_DIR).exists():
    _static    = Path(STATIC_DIR)
    assets_dir = _static / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        return FileResponse(str(_static / "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
