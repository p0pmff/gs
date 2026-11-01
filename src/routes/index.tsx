import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Lock, Radio, Search, Users, X } from "lucide-react";
import { getAllServerStatuses } from "@/lib/query.functions";

type Snapshot = Awaited<ReturnType<typeof getAllServerStatuses>>[number];

const SERVERS = [
  { id: "254", label: "GreenStone", host: "51.38.143.254", port: 7777 },
  { id: "253", label: "GreenStone Beta", host: "51.38.143.253", port: 7777 },
] as const;

type HistoryPoint = { t: number; players: number; online: boolean };
type RangeKey = "1h" | "24h" | "7d";

const RANGE_MS: Record<RangeKey, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

const HISTORY_KEY = "gs-player-history-v1";
const MAX_POINTS = 12_000; // ~7d at 1 sample / 50s
const SAMPLE_EVERY_MS = 15_000;

function loadHistory(): Record<string, HistoryPoint[]> {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, HistoryPoint[]>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveHistory(h: Record<string, HistoryPoint[]>) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  } catch {
    /* quota */
  }
}

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
  const [range, setRange] = useState<RangeKey>("1h");
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({});
  const shown = useRef<Record<string, Snapshot>>(
    Object.fromEntries(initial.map((s) => [`${s.host}:${s.port}`, s])),
  );
  const last = useRef<Record<string, string>>(
    Object.fromEntries(initial.map((s) => [`${s.host}:${s.port}`, fingerprint(s)])),
  );
  const lastSampleAt = useRef<Record<string, number>>({});

  // hydrate history from localStorage
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

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

        // sample history (throttled)
        const now = Date.now();
        setHistory((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const snap of nextSnapshots) {
            const key = `${snap.host}:${snap.port}`;
            const lastAt = lastSampleAt.current[key] ?? 0;
            if (now - lastAt < SAMPLE_EVERY_MS) continue;
            lastSampleAt.current[key] = now;
            const points = next[key] ? [...next[key]] : [];
            points.push({
              t: now,
              players: snap.online ? snap.players : 0,
              online: snap.online,
            });
            // drop older than 7d + buffer
            const cutoff = now - RANGE_MS["7d"] - 60_000;
            while (points.length && points[0]!.t < cutoff) points.shift();
            while (points.length > MAX_POINTS) points.shift();
            next[key] = points;
            changed = true;
          }
          if (changed) saveHistory(next);
          return changed ? next : prev;
        });
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

  const chartPoints = useMemo(() => {
    const all = history[key] ?? [];
    const cutoff = Date.now() - RANGE_MS[range];
    return all.filter((p) => p.t >= cutoff);
  }, [history, key, range]);

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

      {/* History chart */}
      <section className="mt-4 rounded-xl border border-line bg-surface p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Player history</h2>
          <div className="flex gap-1 rounded-lg border border-line bg-surface-2 p-0.5">
            {(["1h", "24h", "7d"] as RangeKey[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={
                  range === r
                    ? "rounded-md bg-surface px-2.5 py-1 text-xs font-medium text-fg"
                    : "rounded-md px-2.5 py-1 text-xs font-medium text-muted hover:text-fg"
                }
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <PlayerChart points={chartPoints} maxPlayers={data.maxPlayers || 100} range={range} />
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

function PlayerChart({
  points,
  maxPlayers,
  range,
}: {
  points: HistoryPoint[];
  maxPlayers: number;
  range: RangeKey;
}) {
  const w = 640;
  const h = 140;
  const padX = 8;
  const padY = 12;

  if (points.length < 2) {
    return (
      <div className="flex h-[140px] items-center justify-center rounded-lg bg-surface-2 text-sm text-muted">
        Collecting data… keep this page open to build history.
      </div>
    );
  }

  const now = Date.now();
  const span = RANGE_MS[range];
  const t0 = now - span;
  const yMax = Math.max(maxPlayers, ...points.map((p) => p.players), 1);

  const coords = points.map((p) => {
    const x = padX + ((p.t - t0) / span) * (w - padX * 2);
    const y = h - padY - (p.players / yMax) * (h - padY * 2);
    return { x, y, ...p };
  });

  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const area =
    line +
    ` L${coords[coords.length - 1]!.x.toFixed(1)},${(h - padY).toFixed(1)}` +
    ` L${coords[0]!.x.toFixed(1)},${(h - padY).toFixed(1)} Z`;

  const peak = Math.max(...points.map((p) => p.players));
  const offlineMs = points.reduce((acc, p, i) => {
    if (p.online) return acc;
    const nextT = points[i + 1]?.t ?? now;
    return acc + (nextT - p.t);
  }, 0);
  const uptimePct = Math.max(0, Math.min(100, 100 - (offlineMs / span) * 100));

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[140px] w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="fillOk" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3dd68c" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#3dd68c" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* grid lines */}
        {[0.25, 0.5, 0.75].map((f) => {
          const y = padY + (1 - f) * (h - padY * 2);
          return (
            <line
              key={f}
              x1={padX}
              x2={w - padX}
              y1={y}
              y2={y}
              stroke="#222"
              strokeWidth="1"
            />
          );
        })}
        <path d={area} fill="url(#fillOk)" />
        <path d={line} fill="none" stroke="#3dd68c" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          Peak <span className="font-mono text-fg">{peak}</span>
        </span>
        <span>
          Uptime ~<span className="font-mono text-fg">{uptimePct.toFixed(0)}%</span>
        </span>
        <span>
          Samples <span className="font-mono text-fg">{points.length}</span>
        </span>
      </div>
    </div>
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
