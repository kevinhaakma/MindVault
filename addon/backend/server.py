"""
MindVault backend — vector memory + knowledge graph for code agents.
Vex lives here. He files things, finds things, and refuses to file secrets.

Three-tier memory:
  hot  — tiny CLAUDE.md per project (agent layer, not here)
  warm — SQLite FTS5 keyword search (microseconds, ~80% of queries)
  cold — LanceDB vector search (BGE-small, 384 dims, semantic fallback)

Graph: edges from (a) cosine sim > 0.75, (b) temporal proximity, (c) explicit tags.
Secrets: regex-scanned at write time, refused with 400.
"""
import os
import re
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

import lancedb
import numpy as np
import pyarrow as pa
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastembed import TextEmbedding
from pydantic import BaseModel
from sklearn.decomposition import PCA

# --- config ---
DATA_DIR = Path(os.environ.get("MINDVAULT_DIR", Path.home() / ".mindvault"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
LANCE_PATH = DATA_DIR / "vectors"
SQLITE_PATH = DATA_DIR / "graph.db"
EMBED_MODEL = "BAAI/bge-small-en-v1.5"
EMBED_DIM = 384
SIM_EDGE_THRESHOLD = 0.75

# --- secret patterns Vex refuses to file ---
SECRET_PATTERNS = [
    (re.compile(r"sk-[a-zA-Z0-9]{20,}"),                              "OpenAI/Anthropic key (sk-)"),
    (re.compile(r"sk-ant-[a-zA-Z0-9\-_]{20,}"),                       "Anthropic key (sk-ant-)"),
    (re.compile(r"ghp_[a-zA-Z0-9]{20,}"),                             "GitHub PAT (ghp_)"),
    (re.compile(r"AKIA[0-9A-Z]{16}"),                                 "AWS access key (AKIA)"),
    (re.compile(r"AIza[0-9A-Za-z\-_]{35}"),                           "Google API key (AIza)"),
    (re.compile(r"xox[baprs]-[a-zA-Z0-9\-]{10,}"),                    "Slack token (xox*)"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),               "PEM private key block"),
    (re.compile(r"eyJ[a-zA-Z0-9_\-]+\.eyJ[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+"), "JWT"),
]


def contains_secret(text: str) -> Optional[str]:
    for pat, name in SECRET_PATTERNS:
        if pat.search(text):
            return name
    return None


# --- lazy embedder (~130 MB, init on first use) ---
_embedder: Optional[TextEmbedding] = None


def embed(texts: list[str]) -> np.ndarray:
    global _embedder
    if _embedder is None:
        _embedder = TextEmbedding(model_name=EMBED_MODEL)
    return np.array(list(_embedder.embed(texts)), dtype=np.float32)


# --- storage init ---
def _init_sqlite() -> sqlite3.Connection:
    conn = sqlite3.connect(SQLITE_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS memories (
            id          TEXT PRIMARY KEY,
            content     TEXT NOT NULL,
            project     TEXT NOT NULL,
            kind        TEXT NOT NULL,
            tags        TEXT,
            created_at  REAL NOT NULL,
            access_count INTEGER DEFAULT 0,
            last_accessed REAL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
            content, tags, project,
            content='memories', content_rowid='rowid'
        );
        CREATE TABLE IF NOT EXISTS edges (
            src    TEXT NOT NULL,
            dst    TEXT NOT NULL,
            kind   TEXT NOT NULL,
            weight REAL NOT NULL,
            PRIMARY KEY (src, dst, kind)
        );
        CREATE INDEX IF NOT EXISTS idx_edges_src      ON edges(src);
        CREATE INDEX IF NOT EXISTS idx_memories_proj  ON memories(project);
        CREATE INDEX IF NOT EXISTS idx_memories_time  ON memories(created_at);
    """)
    conn.commit()
    return conn


def _init_lance():
    db = lancedb.connect(str(LANCE_PATH))
    if "memories" not in db.table_names():
        schema = pa.schema([
            pa.field("id",      pa.string()),
            pa.field("vector",  pa.list_(pa.float32(), EMBED_DIM)),
            pa.field("content", pa.string()),
            pa.field("project", pa.string()),
        ])
        db.create_table("memories", schema=schema)
    return db.open_table("memories")


sql       = _init_sqlite()
vec_table = _init_lance()


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
    project:    str        = "default"
    kind:       str        = "episode"   # episode | lesson | decision | reference
    tags:       list[str]  = []
    related_to: list[str]  = []          # explicit edge targets


class RecallRequest(BaseModel):
    query:   str
    project: Optional[str] = None
    limit:   int           = 5
    mode:    str           = "auto"      # auto | keyword | semantic


# --- graph helpers ---
def _add_edge(src: str, dst: str, kind: str, weight: float):
    if src == dst:
        return
    sql.execute(
        "INSERT OR REPLACE INTO edges (src, dst, kind, weight) VALUES (?, ?, ?, ?)",
        (src, dst, kind, weight),
    )


def _auto_link(mem_id: str, vector: np.ndarray, project: str):
    """kNN in the project; add semantic edges above threshold."""
    if vec_table.count_rows() < 2:
        return
    results = (
        vec_table.search(vector)
        .where(f"project = '{project}'")
        .limit(6)
        .to_list()
    )
    for r in results:
        if r["id"] == mem_id:
            continue
        # LanceDB returns L2 distance on normalized vectors; cos_sim ≈ 1 - dist/2
        sim = 1.0 - (r.get("_distance", 2.0) / 2.0)
        if sim >= SIM_EDGE_THRESHOLD:
            _add_edge(mem_id, r["id"], "semantic", float(sim))
            _add_edge(r["id"], mem_id, "semantic", float(sim))


# --- app ---
app = FastAPI(title="MindVault")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/write")
def write(req: WriteRequest):
    leak = contains_secret(req.content)
    if leak:
        raise HTTPException(
            400,
            f"Vex refuses to file this. Content contains a secret-shaped string ({leak}). "
            "Use the keychain — see `mindvault-secret set <name>`."
        )

    mem_id   = str(uuid.uuid4())
    now      = time.time()
    tags_str = ",".join(req.tags)

    v = embed([req.content])[0]
    v = v / np.linalg.norm(v)

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

        # temporal chain to previous memory in same project
        prev = c.execute(
            "SELECT id FROM memories WHERE project = ? AND id != ? "
            "ORDER BY created_at DESC LIMIT 1",
            (req.project, mem_id),
        ).fetchone()
        if prev:
            _add_edge(prev["id"], mem_id, "temporal", 0.3)

    vec_table.add([{
        "id":      mem_id,
        "vector":  v.tolist(),
        "content": req.content,
        "project": req.project,
    }])

    _auto_link(mem_id, v, req.project)
    return {"id": mem_id, "created_at": now}


@app.post("/recall")
def recall(req: RecallRequest):
    results = []

    if req.mode in ("auto", "keyword"):
        proj_filter = "AND m.project = ?" if req.project else ""
        params = [req.query]
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
        qv = embed([req.query])[0]
        qv = qv / np.linalg.norm(qv)
        search = vec_table.search(qv).limit(req.limit * 2)
        if req.project:
            search = search.where(f"project = '{req.project}'")
        seen = {r["id"] for r in results}
        for r in search.to_list():
            if r["id"] in seen:
                continue
            row = sql.execute(
                "SELECT id, content, project, kind, tags, created_at FROM memories WHERE id = ?",
                (r["id"],),
            ).fetchone()
            if row:
                d        = dict(row)
                d["score"] = float(1.0 - r.get("_distance", 2.0) / 2.0)
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


@app.get("/graph")
def graph(project: Optional[str] = None, limit: int = 1000):
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

    ids     = [n["id"] for n in nodes]
    id_list = ",".join(f"'{i}'" for i in ids)
    vec_rows = (
        vec_table.search()
        .where(f"id IN ({id_list})")
        .limit(len(ids))
        .to_list()
    )
    vec_by_id = {r["id"]: np.array(r["vector"]) for r in vec_rows}

    if len(vec_by_id) >= 3:
        ordered = [i for i in ids if i in vec_by_id]
        vecs    = np.stack([vec_by_id[i] for i in ordered])
        coords  = PCA(n_components=2).fit_transform(vecs)
        coords  = coords / (np.abs(coords).max() + 1e-9)
        coord_by_id = {i: c.tolist() for i, c in zip(ordered, coords)}
    else:
        coord_by_id = {i: [0.0, 0.0] for i in ids}

    for n in nodes:
        n["x"], n["y"] = coord_by_id.get(n["id"], [0.0, 0.0])
        n["preview"]   = n["content"][:140]
        del n["content"]

    edge_rows = sql.execute(
        f"SELECT src, dst, kind, weight FROM edges WHERE src IN ({id_list})"
    ).fetchall()

    return {"nodes": nodes, "edges": [dict(e) for e in edge_rows]}


@app.get("/memory/{mem_id}")
def get_memory(mem_id: str):
    row = sql.execute("SELECT * FROM memories WHERE id = ?", (mem_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Vex has no record of that id.")
    return dict(row)


@app.delete("/memory/{mem_id}")
def delete_memory(mem_id: str):
    with tx() as c:
        # get rowid before deleting the base row (FTS content table needs it)
        rowid_row = c.execute(
            "SELECT rowid FROM memories WHERE id = ?", (mem_id,)
        ).fetchone()
        if rowid_row:
            c.execute("DELETE FROM memories_fts WHERE rowid = ?", (rowid_row[0],))
        c.execute("DELETE FROM memories WHERE id = ?", (mem_id,))
        c.execute("DELETE FROM edges WHERE src = ? OR dst = ?", (mem_id, mem_id))
    try:
        vec_table.delete(f"id = '{mem_id}'")
    except Exception:
        pass
    return {"deleted": mem_id}


@app.post("/prune-orphans")
def prune_orphans(project: Optional[str] = None):
    """Delete nodes with no edges and zero recalls — likely noise."""
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


@app.get("/stats")
def stats():
    total    = sql.execute("SELECT COUNT(*) as c FROM memories").fetchone()["c"]
    edge_ct  = sql.execute("SELECT COUNT(*) as c FROM edges").fetchone()["c"]
    projects = [dict(r) for r in sql.execute(
        "SELECT project, COUNT(*) as count FROM memories GROUP BY project ORDER BY count DESC"
    ).fetchall()]
    return {"memories": total, "edges": edge_ct, "projects": projects}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
