"""
MindVault backend — vector memory + knowledge graph for code agents.

Three-tier memory:
  hot  — tiny CLAUDE.md per project (agent layer, not here)
  warm — SQLite FTS5 keyword search (microseconds, ~80% of queries)
  cold — SQLite BLOB vectors + numpy cosine sim (semantic fallback)

Vectors stored as float32 BLOBs in SQLite — no lancedb/rust required.
fastembed is optional: if onnxruntime crashes, falls back to keyword-only.
"""
import logging
import os
import re
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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
SIM_EDGE_THRESHOLD = 0.75

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
    query:   str
    project: Optional[str] = None
    limit:   int           = 5
    mode:    str           = "auto"


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
    neighbors = _cosine_search(vec, project, 7)
    for n in neighbors:
        if n["id"] == mem_id:
            continue
        if n["score"] >= SIM_EDGE_THRESHOLD:
            _add_edge(mem_id, n["id"], "semantic", n["score"])
            _add_edge(n["id"], mem_id, "semantic", n["score"])


# --- routes ---
VERSION = "0.1.18"


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


@router.post("/recall")
def recall(req: RecallRequest):
    _require_db()
    results = []

    if req.mode in ("auto", "keyword"):
        proj_filter = "AND m.project = ?" if req.project else ""
        params: list = [req.query]
        if req.project:
            params.append(req.project)
        params.append(req.limit)
        rows = sql.execute(
            f"""SELECT m.id, m.content, m.project, m.kind, m.tags, m.created_at,
                       bm25(memories_fts) AS score
                FROM memories_fts
                JOIN memories m ON m.rowid = memories_fts.rowid
                WHERE memories_fts MATCH ? {proj_filter}
                ORDER BY score LIMIT ?""",
            params,
        ).fetchall()
        results = [dict(r) for r in rows]

    if req.mode == "semantic" or (req.mode == "auto" and len(results) < req.limit):
        qvecs = embed([req.query])
        if qvecs is not None:
            qv = qvecs[0]
            qv = qv / (np.linalg.norm(qv) + 1e-9)
            seen = {r["id"] for r in results}
            for hit in _cosine_search(qv, req.project, req.limit * 2):
                if hit["id"] in seen:
                    continue
                row = sql.execute(
                    "SELECT id, content, project, kind, tags, created_at FROM memories WHERE id = ?",
                    (hit["id"],),
                ).fetchone()
                if row:
                    d = dict(row)
                    d["score"] = hit["score"]
                    results.append(d)
                if len(results) >= req.limit:
                    break

    now = time.time()
    for r in results[:req.limit]:
        sql.execute(
            "UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?",
            (now, r["id"]),
        )
    sql.commit()
    return {"results": results[:req.limit]}


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
