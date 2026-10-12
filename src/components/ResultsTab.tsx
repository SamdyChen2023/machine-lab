import * as Dialog from '@radix-ui/react-dialog'
import * as Checkbox from '@radix-ui/react-checkbox'
import { useRef, useState } from 'react'
import { api, type Run, type RunSummary } from '../lib/api'
import { RunView } from './RunView'
import { Card } from './ui'

export function ResultsTab({ runs, selected, setSelected, reload, goCompare }: { runs: RunSummary[]; selected: string[]; setSelected: (f: (p: string[]) => string[]) => void; reload: () => void; goCompare: () => void }) {
  const [open, setOpen] = useState<Run>()
  const [confirm, setConfirm] = useState<string>()
  const [msg, setMsg] = useState<string>()
  const file = useRef<HTMLInputElement>(null)

  const importFiles = async (files: FileList | null) => {
    setMsg(undefined)
    for (const f of Array.from(files ?? [])) {
      try { await api.importRun(JSON.parse(await f.text())) } catch (e) { setMsg(`${f.name}: ${(e as Error).message}`) }
    }
    reload()
  }
  return (
    <Card title={`Saved runs (${runs.length})`} right={
      <div className="flex gap-2">
        <input ref={file} type="file" accept="application/json,.json" multiple hidden onChange={(e) => { importFiles(e.target.files); e.target.value = '' }} />
        <button onClick={() => file.current?.click()} className="rounded-lg bg-white/5 px-3 py-1 text-xs hover:bg-white/10">Import JSON…</button>
        <button disabled={selected.length < 2} onClick={goCompare} className="rounded-lg bg-indigo-500 px-3 py-1 text-xs font-medium disabled:opacity-30">Compare {selected.length || ''} selected</button>
      </div>}>
      {msg && <p className="mb-3 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">{msg}</p>}
      {runs.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">No runs yet. Run a suite from the Benchmarks tab, or import result files from other machines.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="w-8 pb-2" /><th className="pb-2 font-medium">Label</th><th className="pb-2 font-medium">Isolation</th><th className="pb-2 font-medium">CPU</th><th className="pb-2 font-medium">Profile</th><th className="pb-2 font-medium">When</th><th className="pb-2" /></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-white/5 align-middle">
                  <td className="py-2"><Checkbox.Root aria-label={`select ${r.label}`} checked={selected.includes(r.id)} onCheckedChange={(c) => setSelected((p) => (c ? [...p, r.id] : p.filter((x) => x !== r.id)))} className="grid h-4 w-4 place-items-center rounded border border-white/30 data-[state=checked]:border-indigo-400 data-[state=checked]:bg-indigo-500"><Checkbox.Indicator className="text-[10px] leading-none text-white">✓</Checkbox.Indicator></Checkbox.Root></td>
                  <td className="py-2"><div className="font-medium text-slate-200">{r.label}</div>{r.provider && <div className="text-xs text-slate-500">{r.provider}</div>}</td>
                  <td className="py-2 text-xs text-slate-400">{r.virt ?? '—'}</td>
                  <td className="max-w-[14rem] truncate py-2 text-xs text-slate-400" title={r.cpu}>{r.cpu} · {r.vcpus} vCPU</td>
                  <td className="py-2 text-xs"><span className="rounded bg-white/5 px-1.5 py-0.5">{r.profile}</span>{r.errors > 0 && <span className="ml-1 text-rose-300">{r.errors} err</span>}</td>
                  <td className="py-2 text-xs text-slate-500">{new Date(r.startedAt).toLocaleString()}<br />{(r.durationMs / 1000).toFixed(0)} s</td>
                  <td className="space-x-1 whitespace-nowrap py-2 text-right text-xs">
                    <button className="rounded px-2 py-1 hover:bg-white/10" onClick={async () => setOpen(await api.run(r.id))}>View</button>
                    <a className="rounded px-2 py-1 hover:bg-white/10" href={`/api/runs/${encodeURIComponent(r.id)}/download`}>Download</a>
                    {confirm === r.id
                      ? <button className="rounded bg-rose-500/20 px-2 py-1 text-rose-300" onClick={async () => { await api.deleteRun(r.id); setConfirm(undefined); setSelected((p) => p.filter((x) => x !== r.id)); reload() }}>Confirm delete</button>
                      : <button className="rounded px-2 py-1 text-rose-300/80 hover:bg-rose-500/10" onClick={() => setConfirm(r.id)}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog.Root open={!!open} onOpenChange={(o) => !o && setOpen(undefined)}>
        <Dialog.Portal>
          <Dialog.Overlay className="pop fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
          <Dialog.Content className="pop fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[min(60rem,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-white/10 bg-ink-950 p-6 shadow-2xl">
            <Dialog.Title className="text-lg font-semibold">{open?.label}</Dialog.Title>
            <Dialog.Description className="mb-4 text-xs text-slate-500">{open?.profile} profile · {open && new Date(open.startedAt).toLocaleString()} · lab {open?.lab.version}{open?.lab.commit ? `@${open.lab.commit}` : ''}</Dialog.Description>
            {open && <RunView run={open} />}
            <Dialog.Close className="mt-5 w-full rounded-xl bg-white/5 py-2 text-sm hover:bg-white/10">Close</Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Card>
  )
}
