# Machine Lab

Environment fingerprint + repeatable benchmark suite for comparing sandboxes, VMs and containers.
Run it on each machine, collect one JSON file per machine, then compare them side by side.

- **Fingerprint**: CPU details, isolation technology (VM / microVM / container / gVisor, with the evidence), memory and cgroup limits, filesystems and block devices, network, security and capability probes (`/dev/kvm`, FUSE, user namespaces, sudo, …).
- **Benchmarks**: CPU (incl. thread-scaling and sustained load to expose throttling), memory, disk (fio when available), network, and real workloads (gzip, process spawn, small files, `npm ci`). Every test is repeated; the median and the spread (CV) are reported.
- **Live dashboard**: CPU / steal / memory / disk / network at 1 Hz while a suite runs.
- **Two front ends**: a web UI and a headless CLI. Both write the same result files.

## Requirements

- Linux (reads `/proc` and `/sys`). Elsewhere the app starts but most probes return nothing.
- Node >= 20. Optional: `fio`, `sysbench` (used automatically when installed).
- Outbound HTTPS for the network tests; `--no-egress` skips the public-IP lookup.

## Quick start

```bash
npm run setup                       # npm ci && build
npm start                           # web UI on http://localhost:8090  (PORT=... to change)

# or headless, no UI needed:
npm run lab -- run --profile quick --label my-sandbox --out my-sandbox.json
npm run lab -- info                 # fingerprint only
npm run lab -- compare a.json b.json c.json
```

Optional apt packages for industry-standard numbers: `sudo apt-get install -y fio sysbench`.

### CLI options

| command | notes |
|---|---|
| `run` | `--profile quick\|full` · `--groups cpu,memory,disk,network,workload` · `--label` · `--provider` · `--price USD_PER_HOUR` · `--out FILE` · `--no-egress` · `--redact` · `--builtin-only` |
| `info` | `--json` · `--no-egress` · `--redact` |
| `compare` | two or more result files |

`--redact` removes hostname, IPs, MACs and DNS servers from the saved fingerprint so the file is safe to share.

## Profiles

| | quick | full |
|---|---|---|
| repeats (+ warm-up) | 3 | 5 (+1) |
| CPU seconds per run | 3 | 5 |
| extras | – | thread-scaling curve, 60 s sustained load, `npm ci`, 50 MB download / 10 MB upload, extra disk locations (`$HOME`, `/dev/shm` when on a different device) |
| duration | ≈ 1–2 min | ≈ 10 min on a 2-vCPU sandbox (measured: 587 s) |

## How to get comparable numbers

1. **Keep the machine otherwise idle.** On a 2-vCPU sandbox a browser tab or a build running next to the suite changed the single-thread score by ~30 %.
2. **Use the same tools everywhere.** Metric names are prefixed by tool (`fio_`, `sb_`, `js_`, `dd_`). A metric that only one machine has is shown but never scored. `--builtin-only` forces the built-in tests on every machine; install fio and sysbench on all of them otherwise.
3. **Use the same profile**, and run it more than once on different times of day if the platform is shared. The compare view warns on mixed profiles.
4. **Look at the spread.** A median with CV above 25 % is flagged ⚠. Some disks show this (queue-depth-32 reads in particular); report it rather than hide it.
5. Check `cpu.sustained`: a score that drops between the first and the last slice means throttling or exhausted burst credit.

### What the scores mean

The per-group score is the geometric mean of `value / best` (or `best / value` for lower-is-better metrics) over the metrics that at least two machines share. 100 = best on everything. It is a convenient summary, not a standard benchmark; read the individual metrics before drawing conclusions. The built-in JS CPU "score" is a relative number that depends on the Node version.

## Result file

One JSON document (`schema: 1`) per run: `label`, `provider`, `pricePerHour`, `profile`, lab version and commit, the full `fingerprint`, and `results[]` with per-metric `median/mean/min/max/cv/n/samples` plus optional `series` (scaling curve, sustained load). Files from the CLI and the UI are interchangeable; import them on the Results or Compare tab.

## Deploy

```bash
git clone <this-repo> machine-lab && cd machine-lab
bash scripts/deploy-hyperbox.sh              # Hyperbox: build, register a managed service, expose
# or Docker:
docker build -t machine-lab . && docker run --rm -p 8090:8090 -e LAB_TOKEN=change-me machine-lab
```

### Access control

Anyone who can reach the port can start benchmarks. Set `LAB_TOKEN=secret` to require it on all `/api/*` routes: open the page once as `/?token=secret` (it is then kept in a cookie), or send an `x-lab-token` header. Never expose the port publicly without a token.

## Development

```bash
npm install && npm run dev      # Vite on :5173 (proxies /api to :8090) + API
npm test                        # parsers, statistics, comparison logic
npm run build                   # type-check + production bundle
```

Layout: `server/fingerprint.mjs` (what is this machine), `server/tests.mjs` (benchmark definitions and parsers), `server/suite.mjs` (repeat + aggregate + result document), `server/compare.mjs`, `server/cli.mjs`, `server/index.mjs` (API, jobs, auth), `src/` (React UI).

## Not covered (yet)

Sandbox lifecycle timings (cold start, resume), a memory-ceiling probe (unsafe on small hosts), cloud-metadata lookups, and GPU. These need either a host-side stopwatch or carry risk on shared machines.
