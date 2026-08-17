# Musicwire

Musicwire is a deterministic MusicXML validation, MuseScore rendering, automated QC, and attribution API for agents. It does not compose music or invoke a server-side LLM.

## Agent quickstart

Get a static MusicXML authoring prompt and quality bar at no cost:

```sh
curl 'http://localhost:8787/v1/compose-guide?style=waltz&key=F%20major&tempo=84'
```

Validate a score before rendering it:

```sh
curl -X POST http://localhost:8787/v1/validate \
  -H 'content-type: application/json' \
  --data '{"musicxml":"<?xml version=\"1.0\"?><score-partwise version=\"4.0\">...</score-partwise>"}'
```

Submit an asynchronous render. MusicXML, `NOTICE.txt`, and `receipt.json` are always returned. `svg` and `png` results are page sets.

```sh
curl -X POST http://localhost:8787/v1/render \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: a-stable-request-id' \
  --data @request.json

# request.json: {"musicxml":"...","formats":["pdf","svg","mp3"],"constraints_check":{"tempo":84}}
# Poll the returned job_id without charge:
curl http://localhost:8787/v1/jobs/JOB_ID
```

`POST /v1/validate` accepts raw `application/xml` bytes or a JSON `musicxml` string. `POST /v1/render` accepts the same JSON string plus optional `formats` and `constraints_check`. Client filesystem paths and compressed input are rejected.

## API contract

| Endpoint | Price when x402 lands | Result |
| --- | ---: | --- |
| `GET /v1/compose-guide` | Free | Static, versioned BYO-LLM authoring guide. |
| `POST /v1/validate` | $0.05 | `{valid, errors:[{line, measure, message, fix_hint}]}`. |
| `POST /v1/render` | $0.10 solo, $0.25 multi-part | Returns `job_id` and `estimated_seconds`. |
| `GET /v1/jobs/{id}` | Free | Status, QC outcome, hashes, and signed artifact URLs. |
| `GET /health`, `GET /manifest` | Free | Renderer readiness and machine-readable service contract. |

The configured part boundary defaults to one part. MusicXML is the source of truth and is retained with every completed render. Requestable formats are `mscz`, `pdf`, `svg`, `png`, `midi`, `mp3`, and `wav`.

Jobs are `queued`, `running`, `completed`, or `failed_not_charged`. A charge capture is structurally impossible until QC passes. In this phase the payment provider is a credential-free stub. The manifest documents the future `402 Payment Required` shape, but no payment service or wallet is contacted.

QC passes only when MusicXML validates, MuseScore exits successfully, every requested artifact exists, requested audio has a valid container, non-silent RMS, and score-duration agreement within 10%, and optional key, tempo, and duration constraints match. Failures return a typed catalogued error and are not charged.

## Run locally

Requires Node 22.5+, MuseScore Studio 4, and `ffmpeg`/`ffprobe` for audio QC. On Apple silicon, point `MSCORE_BIN` to the app binary and leave `MSCORE_ARCH=arm64`.

```sh
npm install --ignore-scripts
MSCORE_BIN='/Applications/MuseScore 4.app/Contents/MacOS/mscore' \
MSCORE_ARCH=arm64 \
FFPROBE_BIN=ffprobe \
FFMPEG_BIN=ffmpeg \
ARTIFACT_SIGNING_SECRET='replace-with-a-long-random-secret' \
npm start
```

The data directory is configurable with `MUSICWIRE_DATA_DIR` and contains the SQLite job store and content-addressed artifacts. Completed artifacts are retained for at least 30 days by default.

Run automated tests:

```sh
npm test
MUSICWIRE_E2E=1 MSCORE_BIN='/Applications/MuseScore 4.app/Contents/MacOS/mscore' npm run test:e2e
```

The end-to-end test skips cleanly where MuseScore is absent. It renders a real score locally when enabled.

## Container deployment

The image pins the official MuseScore Studio 4.7.2 AppImage, runs it under Xvfb, and includes ffmpeg/ffprobe. It provides deployment parity. The image builds and the container starts locally; a full published-port container rendering smoke test remains a deploy-phase follow-up because Docker Desktop reset loopback connections during the initial probe. The native MuseScore E2E remains the pipeline proof for this phase.

```sh
docker build -t musicwire .
ARTIFACT_SIGNING_SECRET='replace-with-a-long-random-secret' docker compose up
```

## Rights, attribution, and acceptable use

Each completed render includes `NOTICE.txt` containing the installed MS Basic license and FluidR3, Michael Cowgill, and S. Christian Collins attribution. `receipt.json` includes the renderer version, sound profile, soundfont SHA-256 where configured, `rendered_by: "Musicwire"`, and this repository URL.

Customers own their compositions. Audio can be used commercially when the NOTICE travels with it. Musicwire sells a render and QC service and never sells copyright in a composition. Only the pinned MS Basic soundfont is supported. Custom soundfonts, plugins, external XML entities, networked rendering, and copyrighted-melody transcription are prohibited.
