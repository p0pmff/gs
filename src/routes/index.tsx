import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Radio, Search, Users, X } from "lucide-react";
import { getAllServerStatuses } from "@/lib/query.functions";

type Snapshot = Awaited<ReturnType<typeof getAllServerStatuses>>[number];

const SERVERS = [
  { id: "254", label: "GreenStone", host: "51.38.143.254", port: 7777 },
  { id: "253", label: "GreenStone Beta", host: "51.38.143.253", port: 7777 },
] as const;

export const Route = createFileRoute("/")({
  loader: () => getAllServerStatuses(),
  component: Home,
});

function fingerprint(s: Snapshot) {
  return JSON.stringify({
    online: s.online,
    hostname: s.hostname,
    gamemode: s.gamemode,
    language: s.language,
    version: s.version,
    password: s.password,
    players: s.players,
    maxPlayers: s.maxPlayers,
    list: s.playerList.map((p) => [p.id, p.name, p.score, p.ping]),
  });
}

function Home() {
  const initial = Route.useLoaderData();
  const [activeId, setActiveId] = useState<string>(SERVERS[0].id);
  const [snapshots, setSnapshots] = useState<Snapshot[]>(initial);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const shown = useRef<Record<string, Snapshot>>(
    Object.fromEntries(initial.map((s) => [`${s.host}:${s.port}`, s])),
  );
  const last = useRef<Record<string, string>>(
    Object.fromEntries(initial.map((s) => [`${s.host}:${s.port}`, fingerprint(s)])),
  );

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const nextList = await getAllServerStatuses();
        if (!alive) return;
        const nextFailed: Record<string, boolean> = {};
        const nextSnapshots = nextList.map((next) => {
          const key = `${next.host}:${next.port}`;
          const prevShown = shown.current[key];
          if (!next.online && prevShown?.online) {
            nextFailed[key] = false;
            return prevShown;
          }
          const fp = fingerprint(next);
          if (fp !== last.current[key]) {
            last.current[key] = fp;
            shown.current[key] = next;
          }
          nextFailed[key] = !next.online;
          return shown.current[key] ?? next;
        });
        setSnapshots(nextSnapshots);
        setFailed(nextFailed);
      } catch {
        if (!alive) return;
        setFailed((prev) => {
          const all: Record<string, boolean> = { ...prev };
          for (const s of SERVERS) all[`${s.host}:${s.port}`] = true;
          return all;
        });
      }
    };
    void pull();
    const id = window.setInterval(pull, 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const activeServer = SERVERS.find((s) => s.id === activeId) ?? SERVERS[0];
  const data =
    snapshots.find((s) => s.host === activeServer.host && s.port === activeServer.port) ??
    snapshots[0];
  const key = `${data.host}:${data.port}`;
  const isFailed = failed[key] ?? !data.online;

  const ratio =
    data && data.maxPlayers > 0 ? Math.min(100, (data.players / data.maxPlayers) * 100) : 0;

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.playerList;
    return data.playerList.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        String(p.id).includes(q) ||
        String(p.score).includes(q),
    );
  }, [data.playerList, search]);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6 flex items-center gap-4">
        <img
          src="/logo.png"
          alt="GreenStone"
          className="size-14 shrink-0 rounded-xl object-cover ring-1 ring-line sm:size-16"
        />
        <div className="min-w-0">
          <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">
            SA-MP live query
          </p>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight sm:text-3xl">
            GreenStone
          </h1>
        </div>
      </header>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border border-line bg-surface-2 p-1">
        {SERVERS.map((s) => {
          const snap = snapshots.find((x) => x.host === s.host && x.port === s.port);
          const online = snap?.online && !(failed[`${s.host}:${s.port}`] ?? false);
          const isActive = activeId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setActiveId(s.id);
                setSearch("");
              }}
              className={
                isActive
                  ? "flex flex-1 items-center justify-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm font-medium text-fg shadow-sm"
                  : "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-muted hover:text-fg"
              }
            >
              <span
                className={
                  online
                    ? "size-1.5 shrink-0 rounded-full bg-ok"
                    : "size-1.5 shrink-0 rounded-full bg-bad"
                }
                aria-hidden
              />
              <span className="truncate">{s.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold tracking-tight">{data.hostname}</h2>
          <p className="mt-1 font-mono text-sm text-muted">
            {data.host}:{data.port}
          </p>
        </div>
        <StatusPill online={data.online && !isFailed} />
      </div>

      <section className="rounded-xl border border-line bg-surface p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-center gap-2 text-muted">
            <Users className="size-4" aria-hidden />
            <span className="text-sm">Players</span>
          </div>
          <p className="font-mono text-3xl font-medium tabular-nums">
            {data.players}
            <span className="text-lg text-muted"> / {data.maxPlayers}</span>
          </p>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full bg-ok transition-[width] duration-300"
            style={{ width: `${ratio}%` }}
          />
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Meta label="Mode" value={data.gamemode} />
          <Meta label="Language" value={data.language} />
          <Meta label="Version" value={data.version ?? "—"} />
          <Meta label="Access" value={data.password ? "Password" : "Open"} />
        </dl>
      </section>

      <section className="mt-4 overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex flex-col gap-3 border-b border-line px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">Online now</h2>
            <span className="font-mono text-xs text-muted sm:hidden">
              {filteredPlayers.length}
              {search.trim() ? ` / ${data.playerList.length}` : ""} listed
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-xs text-muted sm:inline">
              {filteredPlayers.length}
              {search.trim() ? ` / ${data.playerList.length}` : ""} listed
            </span>
            <div className="relative w-full sm:w-48">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search players…"
                className="w-full rounded-lg border border-line bg-surface-2 py-1.5 pr-8 pl-8 text-sm text-fg placeholder:text-muted outline-none focus:border-ok/50 focus:ring-1 focus:ring-ok/30"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-fg"
                  aria-label="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        </div>
        {data.playerList.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            {data.online
              ? data.players > 100
                ? "More than 100 players — SA-MP does not return the full list."
                : "Nobody is connected."
              : "Server did not answer."}
          </p>
        ) : filteredPlayers.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            No players match “{search.trim()}”.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-5 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Username</th>
                  <th className="px-3 py-2 text-right font-medium">Level</th>
                  <th className="px-5 py-2 text-right font-medium">Ping</th>
                </tr>
              </thead>
              <tbody>
                {filteredPlayers.map((p) => (
                  <tr key={`${p.id}-${p.name}`} className="border-t border-line">
                    <td className="px-5 py-2.5 font-mono text-muted">{p.id}</td>
                    <td className="px-3 py-2.5 font-medium">{p.name}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {p.score}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-muted tabular-nums">
                      {p.ping}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function StatusPill({ online }: { online: boolean }) {
  return (
    <span
      className={
        online
          ? "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ok"
          : "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-bad"
      }
    >
      <Radio className="size-3.5" aria-hidden />
      {online ? "Online" : "Offline"}
    </span>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-medium">{value}</dd>
    </div>
  );
}
