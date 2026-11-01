import { createServerFn } from "@tanstack/react-start";

export const getServerStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { querySamp } = await import("./samp-query.server");
  try {
    return await querySamp();
  } catch {
    return {
      online: false as const,
      hostname: "GreenStone",
      gamemode: "—",
      language: "—",
      version: null as string | null,
      password: false,
      players: 0,
      maxPlayers: 0,
      playerList: [] as { id: number; name: string; score: number; ping: number }[],
      queriedAt: Date.now(),
      source: "udp" as const,
    };
  }
});
