"""
MindVault MCP server — Vex speaks here.

Three tools for any MCP client (Claude Code, Claude Desktop, Cursor, etc.):

  recall      — ask what Vex remembers; cheap, call it often
  remember    — hand Vex a note; he files it, cross-references it, refuses secrets
  get_secret  — Vex fetches a key from the vault and places it in the env;
                the raw value never enters model context

Run: python mcp/server.py
"""
import asyncio
import os
import subprocess
import sys
from typing import Optional

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

BACKEND = os.environ.get("MINDVAULT_URL", "http://127.0.0.1:8765")

app = Server("mindvault")


def _detect_project() -> str:
    """git repo root basename, fallback to cwd basename."""
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=2,
        )
        if r.returncode == 0:
            return os.path.basename(r.stdout.strip())
    except Exception:
        pass
    return os.path.basename(os.getcwd())


@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="recall",
            description=(
                "Ask Vex what he remembers. Smart hybrid retrieval: he combines keyword "
                "(bm25) + semantic (embedding cosine) + recency + recall-frequency into a "
                "single relevance score. Set include_neighbors=true to also pull 1-hop "
                "graph neighbors of the top hits — gives you the surrounding cluster, not "
                "just the direct match. Cheap — call it often."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "What you want to remember. Keywords or natural language.",
                    },
                    "project": {
                        "type": "string",
                        "description": "Project name. Omit and Vex detects from the current git repo.",
                    },
                    "limit": {"type": "integer", "default": 5},
                    "include_neighbors": {
                        "type": "boolean",
                        "default": False,
                        "description": "If true, expand top hits with edge-connected memories.",
                    },
                },
                "required": ["query"],
            },
        ),
        Tool(
            name="remember",
            description=(
                "Hand Vex a note for the permanent archive. Call this only after you've "
                "actually learned something durable: a project convention, a non-obvious fix, "
                "a decision worth preserving. He'll embed it, file it, and draw edges to related "
                "memories automatically. Keep entries 1–3 sentences, high-signal. "
                "Do NOT pass secrets — Vex will refuse and log a complaint."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "content": {"type": "string"},
                    "kind": {
                        "type": "string",
                        "enum": ["episode", "lesson", "decision", "reference"],
                        "default": "episode",
                        "description": "episode=what happened, lesson=what was learned, "
                                       "decision=why we chose X, reference=pointer to a thing",
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "default": [],
                        "description": "Short labels. Vex uses them in keyword search.",
                    },
                    "project": {
                        "type": "string",
                        "description": "Omit and Vex detects from git.",
                    },
                    "related_to": {
                        "type": "array",
                        "items": {"type": "string"},
                        "default": [],
                        "description": "IDs from a prior recall call. Vex draws explicit edges.",
                    },
                },
                "required": ["content"],
            },
        ),
        Tool(
            name="get_secret",
            description=(
                "Vex fetches a named key from the OS keychain vault. "
                "He will not show it to you — that is the point. "
                "He writes it to a 0600-protected env file and returns only a confirmation. "
                "Run your next shell command via `mindvault-run <command>` and it will have "
                "$MINDVAULT_SECRET_<NAME> available in its environment. "
                "Store keys with: mindvault-secret set <name>"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the secret as stored in the keychain.",
                    },
                },
                "required": ["name"],
            },
        ),
    ]


async def _http(method: str, path: str, **kwargs) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.request(method, f"{BACKEND}{path}", **kwargs)
        r.raise_for_status()
        return r.json()


@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    try:
        if name == "recall":
            payload = {
                "query":             arguments["query"],
                "project":           arguments.get("project") or _detect_project(),
                "limit":             arguments.get("limit", 5),
                "mode":              "smart",
                "include_neighbors": arguments.get("include_neighbors", False),
            }
            data = await _http("POST", "/recall", json=payload)
            if not data["results"]:
                return [TextContent(
                    type="text",
                    text="Vex checked the archive. Nothing matched. You're on your own for this one.",
                )]
            lines = [f"Vex found {len(data['results'])} record(s):"]
            for r in data["results"]:
                tags  = f" [{r['tags']}]" if r.get("tags") else ""
                via   = " (related)" if r.get("via") == "neighbor" else ""
                score = f" score={r['score']:.2f}" if isinstance(r.get("score"), (int, float)) else ""
                lines.append(f"  ({r['id'][:8]}){via} {r['kind']}{tags}{score}: {r['content']}")
            return [TextContent(type="text", text="\n".join(lines))]

        if name == "remember":
            payload = {
                "content":    arguments["content"],
                "project":    arguments.get("project") or _detect_project(),
                "kind":       arguments.get("kind", "episode"),
                "tags":       arguments.get("tags", []),
                "related_to": arguments.get("related_to", []),
            }
            data = await _http("POST", "/write", json=payload)
            return [TextContent(
                type="text",
                text=f"Filed. ({data['id'][:8]}) Vex has it.",
            )]

        if name == "get_secret":
            sec_name = arguments["name"]
            value    = _load_secret(sec_name)
            if value is None:
                return [TextContent(
                    type="text",
                    text=(
                        f"Vex checked the vault. No entry named '{sec_name}'. "
                        f"Store it with: mindvault-secret set {sec_name}"
                    ),
                )]
            env_file = os.path.expanduser("~/.mindvault/session.env")
            os.makedirs(os.path.dirname(env_file), exist_ok=True)
            existing: dict[str, str] = {}
            if os.path.exists(env_file):
                with open(env_file) as f:
                    for line in f:
                        if "=" in line:
                            k, _, v = line.partition("=")
                            existing[k.strip()] = v.strip()
            existing[f"MINDVAULT_SECRET_{sec_name.upper()}"] = value
            with open(env_file, "w") as f:
                for k, v in existing.items():
                    f.write(f"{k}={v}\n")
            os.chmod(env_file, 0o600)
            return [TextContent(
                type="text",
                text=(
                    f"Loaded '{sec_name}' into the session env. "
                    f"Prefix your command with `mindvault-run` — "
                    f"the secret will be available as $MINDVAULT_SECRET_{sec_name.upper()}. "
                    "Vex is not showing you the value."
                ),
            )]

        return [TextContent(type="text", text=f"Vex does not know the tool '{name}'.")]

    except httpx.HTTPStatusError as e:
        detail = ""
        try:
            detail = e.response.json().get("detail", "")
        except Exception:
            pass
        return [TextContent(type="text", text=f"Backend error: {detail or str(e)}")]
    except Exception as e:
        return [TextContent(type="text", text=f"error: {e}")]


def _load_secret(name: str) -> Optional[str]:
    """OS keychain via keyring, then `pass` as fallback."""
    try:
        import keyring
        v = keyring.get_password("mindvault", name)
        if v:
            return v
    except Exception:
        pass
    try:
        r = subprocess.run(
            ["pass", f"mindvault/{name}"],
            capture_output=True, text=True, timeout=3,
        )
        if r.returncode == 0:
            return r.stdout.strip()
    except Exception:
        pass
    return None


async def main():
    async with stdio_server() as (read, write):
        await app.run(read, write, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
