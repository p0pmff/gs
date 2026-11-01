import dgram from "node:dgram";

export type SampPlayer = {
  id: number;
  name: string;
  score: number;
  ping: number;
};

export type SampSnapshot = {
  online: boolean;
  hostname: string;
  gamemode: string;
  language: string;
  version: string | null;
  password: boolean;
  players: number;
  maxPlayers: number;
  playerList: SampPlayer[];
  queriedAt: number;
  source: "udp";
};

const HOST = "51.38.143.254";
const PORT = 7777;

function packet(opcode: string) {
  const ip = HOST.split(".").map(Number);
  const buf = Buffer.alloc(11);
  buf.write("SAMP", 0);
  buf[4] = ip[0]!;
  buf[5] = ip[1]!;
  buf[6] = ip[2]!;
  buf[7] = ip[3]!;
  buf.writeUInt16LE(PORT, 8);
  buf[10] = opcode.charCodeAt(0);
  return buf;
}

function ask(opcode: string, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      sock.close();
      reject(new Error(`timeout:${opcode}`));
    }, timeoutMs);
    sock.once("error", (err) => {
      clearTimeout(timer);
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      reject(err);
    });
    sock.once("message", (msg) => {
      clearTimeout(timer);
      sock.close();
      resolve(msg);
    });
    sock.send(packet(opcode), PORT, HOST);
  });
}

function readLenString(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset);
  const start = offset + 4;
  const end = Math.min(start + len, buf.length);
  return [buf.subarray(start, end).toString("latin1"), end];
}

function parseInfo(buf: Buffer) {
  let o = 11;
  const password = buf[o] === 1;
  o += 1;
  const players = buf.readUInt16LE(o);
  o += 2;
  const maxPlayers = buf.readUInt16LE(o);
  o += 2;
  let hostname: string;
  let gamemode: string;
  let language: string;
  [hostname, o] = readLenString(buf, o);
  [gamemode, o] = readLenString(buf, o);
  [language, o] = readLenString(buf, o);
  return { password, players, maxPlayers, hostname, gamemode, language };
}

function parsePlayers(buf: Buffer): SampPlayer[] {
  if (buf.length < 13) return [];
  let o = 11;
  const count = buf.readUInt16LE(o);
  o += 2;
  const list: SampPlayer[] = [];
  const n = Math.min(count, 100);
  for (let i = 0; i < n; i++) {
    if (o + 2 > buf.length) break;
    const id = buf[o]!;
    o += 1;
    const nameLen = buf[o]!;
    o += 1;
    if (o + nameLen + 8 > buf.length) break;
    const name = buf.subarray(o, o + nameLen).toString("latin1");
    o += nameLen;
    const score = buf.readInt32LE(o);
    o += 4;
    const ping = buf.readUInt32LE(o);
    o += 4;
    list.push({ id, name, score, ping });
  }
  return list;
}

function parseRules(buf: Buffer): Record<string, string> {
  const rules: Record<string, string> = {};
  if (buf.length < 13) return rules;
  let o = 11;
  const count = buf.readUInt16LE(o);
  o += 2;
  for (let i = 0; i < count; i++) {
    if (o + 1 > buf.length) break;
    const keyLen = buf[o]!;
    o += 1;
    if (o + keyLen + 1 > buf.length) break;
    const key = buf.subarray(o, o + keyLen).toString("latin1");
    o += keyLen;
    const valLen = buf[o]!;
    o += 1;
    if (o + valLen > buf.length) break;
    const val = buf.subarray(o, o + valLen).toString("latin1");
    o += valLen;
    rules[key] = val;
  }
  return rules;
}

let inflight: Promise<SampSnapshot> | null = null;
let cached: { at: number; data: SampSnapshot } | null = null;
let lastGood: SampSnapshot | null = null;

async function queryFresh(): Promise<SampSnapshot> {
  const infoBuf = await ask("i", 2500);
  const info = parseInfo(infoBuf);
  const [playersBuf, rulesBuf] = await Promise.all([
    info.players > 0 ? ask("d", 2500).catch(() => null) : Promise.resolve(null),
    ask("r", 1500).catch(() => null),
  ]);
  const rules = rulesBuf ? parseRules(rulesBuf) : {};
  const playerList = playersBuf ? parsePlayers(playersBuf) : [];
  playerList.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return {
    online: true,
    hostname: info.hostname,
    gamemode: info.gamemode,
    language: info.language,
    version: rules.version ?? null,
    password: info.password,
    players: info.players,
    maxPlayers: info.maxPlayers,
    playerList,
    queriedAt: Date.now(),
    source: "udp",
  };
}

export async function querySamp(): Promise<SampSnapshot> {
  const now = Date.now();
  if (cached && now - cached.at < 900) return cached.data;
  if (!inflight) {
    inflight = (async () => {
      try {
        const data = await queryFresh();
        lastGood = data;
        cached = { at: Date.now(), data };
        return data;
      } catch (err) {
        try {
          const data = await queryFresh();
          lastGood = data;
          cached = { at: Date.now(), data };
          return data;
        } catch {
          if (lastGood && Date.now() - lastGood.queriedAt < 20_000) return lastGood;
          throw err;
        }
      }
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}
