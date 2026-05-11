# Installing MindVault on Home Assistant OS

Vex runs as a Home Assistant add-on. Your HA server is at `100.70.193.9` (Tailscale).

## One-time setup

### 1. Push the repo to GitHub

```bash
cd C:\Users\k.w.haakma\Desktop\Projects\mindvault
git init
git add .
git commit -m "Initial MindVault"
# Create a repo on github.com, then:
git remote add origin https://github.com/kevhaakma/mindvault.git
git push -u origin main
```

### 2. Add as a custom add-on repository in HA

1. Open your HA dashboard → **Settings** → **Add-ons** → **Add-on Store**
2. Click ⠿ (three dots, top-right) → **Repositories**
3. Paste your GitHub URL: `https://github.com/kevhaakma/mindvault`
4. Click **Add** → **Close**
5. Scroll down to find **MindVault** in the store
6. Click it → **Install**

HA will build the container (takes ~5 minutes — fastembed downloads the model on first start).

### 3. Start the add-on

In the add-on page:
- Toggle **Start on boot** ON
- Click **Start**
- Check **Log** tab — you should see uvicorn and nginx startup messages

### 4. Access

| What | URL |
|---|---|
| GUI | `http://100.70.193.9:7653` |
| API (for MCP) | `http://100.70.193.9:8765` |

### 5. MCP config on each client machine

In `~/.claude/claude_desktop_config.json` (or project `.mcp.json`):

```json
{
  "mcpServers": {
    "mindvault": {
      "command": "python",
      "args": ["/path/to/mindvault/mcp/server.py"],
      "env": {
        "MINDVAULT_URL": "http://100.70.193.9:8765"
      }
    }
  }
}
```

---

## Updating

When you change backend or GUI code:

```bash
./scripts/sync-addon.sh   # copies source into addon/
git add addon/ && git commit -m "update add-on"
git push
```

Then in HA: **Settings** → **Add-ons** → **MindVault** → **Update** (or it auto-detects).

Data persists across updates in the add-on's `/data` volume.

---

## Logs & debugging

In HA UI → Add-ons → MindVault → **Log** tab.

Or via SSH add-on (if installed):
```bash
docker logs $(docker ps -q --filter label=io.hass.slug=mindvault)
```

---

## Ports

| Container port | Host port | Purpose |
|---|---|---|
| 80 | 7653 | GUI (nginx) |
| 8765 | 8765 | API (uvicorn — MCP clients) |

Both bound to all interfaces — Tailscale on the server restricts access to Tailscale peers only.
