#!/usr/bin/env python3
"""
发布后主动推送 URL 给搜索引擎。

用法:
    python3 scripts/ping-search-engines.py [--baidu-token TOKEN] [--dry-run]

URL 来源: dist/sitemap-0.xml（构建产物），未构建时回退到 sitemap.xml 索引里的地址。
密钥来源: 环境变量 BAIDU_PUSH_TOKEN；IndexNow 的 key 从 public/*.txt 自动探测。
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = "wanjiacun.com"
SITE = f"https://{HOST}"
UA = "Mozilla/5.0 (compatible; wanjiacun-publisher/1.0)"


def collect_urls() -> list[str]:
    """从构建产物里收集可提交的 URL（不包含 404 页）。"""
    for candidate in ("dist/sitemap-0.xml", "dist/sitemap-index.xml"):
        p = ROOT / candidate
        if not p.exists():
            continue
        text = p.read_text(encoding="utf-8")
        urls = re.findall(r"<loc>(.*?)</loc>", text)
        urls = [u for u in urls if not u.rstrip("/").endswith("/404")]
        if urls:
            return urls
    print("× 找不到 sitemap 产物，请先运行 npm run build", file=sys.stderr)
    return []


def find_indexnow_key() -> str | None:
    """IndexNow 的密钥文件形如 public/<32位hex>.txt，内容等于文件名。"""
    for f in (ROOT / "public").glob("*.txt"):
        stem = f.stem
        if len(stem) >= 8 and f.read_text(encoding="utf-8").strip() == stem:
            return stem
    return None


def post(url: str, body: bytes, content_type: str) -> tuple[int, str]:
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": content_type,
        "User-Agent": UA,
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")[:300]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:300]
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baidu-token", default=os.environ.get("BAIDU_PUSH_TOKEN", ""))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    urls = collect_urls()
    if not urls:
        return 1
    print(f"→ 待推送 {len(urls)} 个 URL")

    if args.dry_run:
        for u in urls:
            print("   ", u)
        return 0

    # --- 百度 ---
    if args.baidu_token:
        endpoint = f"http://data.zz.baidu.com/urls?site={SITE}&token={args.baidu_token}"
        status, detail = post(endpoint, "\n".join(urls).encode(), "text/plain")
        print(f"[百度]   HTTP {status}  {detail}")
    else:
        print("[百度]   跳过（未提供 token，设 BAIDU_PUSH_TOKEN 或传 --baidu-token）")

    # --- IndexNow（必应 / Yandex 等）---
    key = find_indexnow_key()
    if key:
        payload = json.dumps({
            "host": HOST,
            "key": key,
            "keyLocation": f"{SITE}/{key}.txt",
            "urlList": urls,
        }).encode()
        for ep in ("https://api.indexnow.org/indexnow", "https://www.bing.com/indexnow"):
            status, detail = post(ep, payload, "application/json; charset=utf-8")
            print(f"[IndexNow/{ep.split('/')[2]}]  HTTP {status}  {detail}")
    else:
        print("[IndexNow] 跳过（public/ 下没找到密钥文件）")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
