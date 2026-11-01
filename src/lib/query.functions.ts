import { createServerFn } from "@tanstack/react-start";

export const getAllServerStatuses = createServerFn({ method: "GET" }).handler(async () => {
  const { SERVERS, querySamp, offlineSnapshot } = await import("./samp-query.server");
  const results = await Promise.all(
    SERVERS.map(async (s) => {
      try {
        return await querySamp(s.host, s.port);
      } catch {
        return offlineSnapshot(s.host, s.port, s.label);
      }
    }),
  );
  return results;
});
