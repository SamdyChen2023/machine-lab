# Machine Lab

Live system monitor and benchmark suite, for checking what a sandbox / VM can actually do.

- **Backend** (`server/`): Express. Samples `/proc` once a second and streams it over SSE; exposes CPU, memory, disk and network benchmarks.
- **Frontend** (`src/`): Vite, React 19, Tailwind 4, Radix UI. Charts are hand-written SVG.
- Benchmark results are stored in `data/results.json` (git-ignored).

## Requirements

- Linux (reads `/proc`; benchmarks use GNU `dd` and `ps`). On other OSes the app starts but metrics show zeros.
- Node >= 20
- Outbound HTTPS for the network benchmark (example.com, github.com, cloudflare.com, registry.npmjs.org, speed.cloudflare.com)

## Run

```bash
npm run setup      # npm ci && build
npm start          # http://localhost:8090  (PORT=... to change)
```

Development: `npm install && npm run dev` (Vite on :5173, proxies `/api` to :8090).

## Deploy to a Hyperbox sandbox

```bash
git clone <this-repo> machine-lab && cd machine-lab
bash scripts/deploy-hyperbox.sh        # optional port argument, default 8090
```

This builds the app, registers it as a managed service (restarts on crash and after the sandbox wakes) and prints a preview URL.

## Notes on the benchmarks

- Only one benchmark runs at a time; the dashboard shows which one.
- CPU: worker threads run SHA-256, a prime sieve and recursive fib, each for a third of the time. With the baseline switch on it also runs 1 thread and reports speed-up and scaling efficiency. The score is a relative number for comparing runs on the same machine, not a standard benchmark.
- Disk: `dd` with `O_DIRECT`, falling back to buffered + fdatasync on filesystems that reject it (the result records which was used).
- Results are single runs; repeat them, especially on shared hosts.
