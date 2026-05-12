"""One-shot: add DNS A record at TransIP, update LE addon, restart nginx_proxy."""
import base64
import json
import os
import secrets
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError

MINDVAULT = "http://100.70.193.9:8765"
PUBLIC_IP = "178.229.104.150"  # ha.kvn.frl public IP
DOMAIN_ROOT = "kvn.frl"
SUBDOMAIN   = "vex"
FQDN        = f"{SUBDOMAIN}.{DOMAIN_ROOT}"


def _get(url):
    return json.loads(urlopen(url, timeout=15).read())


def _post(url, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else b""
    req = Request(url, data=data, method="POST")
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    req.add_header("Content-Type", "application/json")
    return json.loads(urlopen(req, timeout=30).read())


def fetch_creds():
    info = _get(f"{MINDVAULT}/api/supervisor/addons/core_letsencrypt/info")
    opts = info["data"]["options"]
    return opts["dns"]["transip_username"], opts["dns"]["transip_api_key"], opts


def transip_auth(username, private_key_pem):
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    body = json.dumps({
        "login":            username,
        "nonce":            secrets.token_hex(16),
        "read_only":        False,
        "expiration_time":  "10 minutes",
        "label":            f"MindVault {SUBDOMAIN} setup {int(time.time())}",
        "global_key":       True,
    }).encode()
    key = serialization.load_pem_private_key(private_key_pem.encode(), password=None)
    sig = key.sign(body, padding.PKCS1v15(), hashes.SHA512())
    req = Request("https://api.transip.nl/v6/auth", data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Signature", base64.b64encode(sig).decode())
    return json.loads(urlopen(req, timeout=30).read())["token"]


def list_dns(token, domain):
    req = Request(f"https://api.transip.nl/v6/domains/{domain}/dns")
    req.add_header("Authorization", f"Bearer {token}")
    return json.loads(urlopen(req, timeout=30).read())["dnsEntries"]


def add_dns_entry(token, domain, entry):
    body = json.dumps({"dnsEntry": entry}).encode()
    req = Request(f"https://api.transip.nl/v6/domains/{domain}/dns",
                  data=body, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        urlopen(req, timeout=30).read()
        return True
    except HTTPError as e:
        err = e.read().decode(errors="ignore")
        if "already exists" in err.lower():
            return False
        raise


def main():
    print(f"=== TransIP DNS: ensure {FQDN} A → {PUBLIC_IP} ===")
    user, key, le_opts = fetch_creds()
    print(f"  TransIP user: {user}")

    token = transip_auth(user, key)
    print("  Auth OK")

    entries = list_dns(token, DOMAIN_ROOT)
    existing = [e for e in entries if e["name"] == SUBDOMAIN and e["type"] == "A"]
    if existing:
        print(f"  A record already present: {existing[0]['content']}")
    else:
        entry = {"name": SUBDOMAIN, "expire": 3600, "type": "A", "content": PUBLIC_IP}
        added = add_dns_entry(token, DOMAIN_ROOT, entry)
        print(f"  {'Added' if added else 'Skipped (exists)'} A record for {SUBDOMAIN}")

    print(f"\n=== Let's Encrypt: add {FQDN} to domains list ===")
    domains = le_opts.get("domains", [])
    if FQDN in domains:
        print(f"  {FQDN} already in LE domains list")
    else:
        new_opts = dict(le_opts)
        new_opts["domains"] = domains + [FQDN]
        r = _post(f"{MINDVAULT}/api/supervisor/addons/core_letsencrypt/options",
                  {"options": new_opts})
        print(f"  Update options: {r.get('result', r)}")

    print("\n=== Trigger LE certificate renewal ===")
    r = _post(f"{MINDVAULT}/api/supervisor/addons/core_letsencrypt/start")
    print(f"  Start LE: {r.get('result', r)}")

    print("\n=== Restart nginx_proxy to pick up new cert + load vex.conf ===")
    print("  Waiting 90s for LE to obtain cert via DNS-01...")
    time.sleep(90)
    r = _post(f"{MINDVAULT}/api/supervisor/addons/core_nginx_proxy/restart")
    print(f"  Restart nginx: {r.get('result', r)}")

    print("\n=== Verify ===")
    time.sleep(10)
    try:
        v = _get(f"https://{FQDN}/api/version")
        print(f"  https://{FQDN}/api/version → {v}")
    except Exception as e:
        print(f"  https://{FQDN} not reachable yet: {e}")
        print("  (may take a few minutes for DNS to propagate)")


if __name__ == "__main__":
    main()
