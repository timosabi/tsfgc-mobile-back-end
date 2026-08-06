import type { Response } from "express";
import { supabaseService } from "../integrations/supabase/supabaseClient.js";

type Entry = {
  clients: Set<Response>;
  channel: ReturnType<typeof supabaseService.channel>;
};

const hubs = new Map<string, Entry>();

function send(res: Response, data: unknown) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function ensureChannel(leagueId: string): Entry {
  let entry = hubs.get(leagueId);
  if (entry) return entry;

  const clients = new Set<Response>();
  const channel = supabaseService
    .channel(`submission_count_${leagueId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "user_submissions",
        filter: `friends_group_id=eq.${leagueId}`,
      },
      () => {
        for (const client of clients) send(client, { type: "change" });
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        for (const client of clients) send(client, { type: "ready" });
      }
    });

  entry = { clients, channel };
  hubs.set(leagueId, entry);
  return entry;
}

export function attachSSE(res: Response, leagueId: string) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const entry = ensureChannel(leagueId);
  entry.clients.add(res);

  const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);

  res.on("close", () => {
    clearInterval(ping);
    entry.clients.delete(res);
    if (entry.clients.size === 0) {
      supabaseService.removeChannel(entry.channel);
      hubs.delete(leagueId);
    }
    try {
      res.end();
    } catch {}
  });
}
