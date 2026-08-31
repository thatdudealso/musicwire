#!/usr/bin/env python3
"""Pay live Musicwire validate/render via awal x402, poll job, download mp3."""

from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HOST = "https://musicwire.5432wire.com"


def awal_pay(url: str, body: dict, idempotency: str, max_amount: str, work: Path, label: str) -> dict:
    payload = json.dumps(body, separators=(",", ":"))
    headers = json.dumps(
        {"Content-Type": "application/json", "Idempotency-Key": idempotency}
    )
    cmd = [
        "npx",
        "awal",
        "x402",
        "pay",
        "-X",
        "POST",
        "-d",
        payload,
        "-h",
        headers,
        "--max-amount",
        max_amount,
        "--json",
        url,
    ]
    print(f"invoking awal {label} key={idempotency} body_chars={len(payload)}", flush=True)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    (work / f"{label}-stderr.txt").write_text(proc.stderr)
    (work / f"{label}-stdout.txt").write_text(proc.stdout)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr[-4000:])
        raise SystemExit(f"awal {label} exited {proc.returncode}")
    return json.loads(proc.stdout)


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=60) as resp:
        return json.loads(resp.read().decode())


def download(url: str, dest: Path) -> None:
    with urllib.request.urlopen(url, timeout=120) as resp:
        dest.write_bytes(resp.read())


if __name__ == "__main__":
    xml_path = Path(sys.argv[1])
    work = Path(sys.argv[2])
    stem = sys.argv[3]
    work.mkdir(parents=True, exist_ok=True)
    musicxml = xml_path.read_text()

    validate_body = {"musicxml": musicxml}
    (work / "validate-body.json").write_text(json.dumps(validate_body))
    validate = awal_pay(
        f"{HOST}/v1/validate",
        validate_body,
        f"{stem}-validate-1",
        "100000",
        work,
        "validate",
    )
    data = validate.get("data", validate)
    if not data.get("valid"):
        raise SystemExit(f"validate failed: {json.dumps(data)[:2000]}")
    print(
        "validate settled",
        data.get("payment", {}).get("amount_usd"),
        data.get("payment", {}).get("tx_hash"),
        flush=True,
    )

    render_body = {"musicxml": musicxml, "formats": ["mp3"]}
    (work / "render-body.json").write_text(json.dumps(render_body))
    render = awal_pay(
        f"{HOST}/v1/render",
        render_body,
        f"{stem}-render-1",
        "500000",
        work,
        "render",
    )
    job = render.get("data", render)
    job_id = job.get("job_id")
    if not job_id:
        raise SystemExit(f"render missing job_id: {json.dumps(job)[:2000]}")
    print("render queued", job_id, flush=True)

    for _ in range(60):
        time.sleep(3)
        job = get_json(f"{HOST}/v1/jobs/{job_id}")
        (work / "job.json").write_text(json.dumps(job, indent=2))
        status = job.get("status")
        print("job", status, flush=True)
        if status in {"completed", "failed", "failed_not_charged"}:
            break
    else:
        raise SystemExit("job poll timeout")

    if job.get("status") != "completed":
        raise SystemExit(f"job {job.get('status')}: {json.dumps(job.get('error'))}")

    for _ in range(20):
        tx = (job.get("payment") or {}).get("tx_hash")
        if tx:
            break
        time.sleep(2)
        job = get_json(f"{HOST}/v1/jobs/{job_id}")
        (work / "job.json").write_text(json.dumps(job, indent=2))
        print("settlement", (job.get("payment") or {}).get("status"), flush=True)

    mp3 = next(a for a in job["artifacts"] if a["name"] == "score.mp3")
    dest = work / "score.mp3"
    download(HOST + mp3["url"], dest)
    print("mp3", dest, dest.stat().st_size, flush=True)
    print(
        "payment",
        job.get("payment", {}).get("amount_usd"),
        job.get("payment", {}).get("tx_hash"),
        flush=True,
    )
    print("qc", job.get("qc"), flush=True)
