import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Lock, Radio, RefreshCw, Users } from "lucide-react";
import { getServerStatus } from "@/lib/query.functions";

type Snapshot = Awaited<ReturnType<typeof getServerStatus>>;

export const Route = createFileRoute("/")({
  loader: () => getServerStatus(),
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
  const [data, setData] = useState<Snapshot>(initial);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const shown = useRef(initial);
  const last = useRef(fingerprint(initial));

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const next = await getServerStatus();
        if (!alive) return;
        if (!next.online && shown.current.online) {
          setTick((n) => n + 1);
          return;
        }
        const fp = fingerprint(next);
        if (fp !== last.current) {
          last.current = fp;
          shown.current = next;
          setData(next);
        }
        setFailed(!next.online);
        setTick((n) => n + 1);
      } catch {
        if (!alive) return;
        setFailed(true);
      }
    };
    void pull();
    const id = window.setInterval(pull, 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const ratio =
    data && data.maxPlayers > 0 ? Math.min(100, (data.players / data.maxPlayers) * 100) : 0;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">
            SA-MP live query
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {data.hostname}
          </h1>
          <p className="mt-1 font-mono text-sm text-muted">51.38.143.254:7777</p>
        </div>
        <StatusPill online={data.online && !failed} />
      </header>

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
        {data.password ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-warn">
            <Lock className="size-3.5" aria-hidden />
            Server is password protected. Player names still come from the query.
          </p>
        ) : null}
      </section>

      <section className="mt-4 overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-medium">Online now</h2>
          <span className="font-mono text-xs text-muted">
            {data.playerList.length} listed
          </span>
        </div>
        {data.playerList.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            {data.online
              ? data.players > 100
                ? "More than 100 players — SA-MP does not return the full list."
                : "Nobody is connected."
              : "Server did not answer."}
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
                {data.playerList.map((p) => (
                  <tr key={`${p.id}-${p.name}`} className="border-t border-line">
                    <td className="px-5 py-2.5 font-mono text-muted">{p.id}</td>
                    <td className="px-3 py-2.5 font-medium">{p.name}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{p.score}</td>
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

      <footer className="mt-6 flex items-center justify-between text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <RefreshCw className="size-3" aria-hidden />
          Checks every second · updates only when something changes
        </span>
        <span className="font-mono">{tick > 0 ? `${tick} checks` : ""}</span>
      </footer>
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
