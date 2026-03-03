const http = require("http");
const { URL } = require("url");
const { Server } = require("socket.io");

const port = Number(process.env.REALTIME_PORT || 4001);
const emitToken = (process.env.REALTIME_EMIT_TOKEN || "").trim();
const corsOrigin = process.env.REALTIME_CORS_ORIGIN || "*";

const presenceByOrg = new Map();

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type, X-Realtime-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

function safeString(input, fallback) {
  if (typeof input === "string" && input.trim().length > 0) {
    return input.trim();
  }
  return fallback;
}

function normalizeUser(input) {
  const raw = input && typeof input === "object" ? input : {};
  const palette = [
    "bg-blue-500",
    "bg-emerald-500",
    "bg-amber-500",
    "bg-cyan-500",
    "bg-rose-500"
  ];

  return {
    id: safeString(raw.id, `session-${Math.random().toString(36).slice(2, 10)}`),
    name: safeString(raw.name, "Carbon Node"),
    color: palette.includes(raw.color) ? raw.color : palette[Math.floor(Math.random() * palette.length)]
  };
}

function roomName(orgId) {
  return `org:${orgId}`;
}

function ensureOrgPresence(orgId) {
  if (!presenceByOrg.has(orgId)) {
    presenceByOrg.set(orgId, new Map());
  }
  return presenceByOrg.get(orgId);
}

function publishPresence(io, orgId) {
  const map = presenceByOrg.get(orgId);
  const users = map ? Array.from(map.values()) : [];
  io.to(roomName(orgId)).emit("presence:update", {
    orgId,
    users,
    count: users.length,
    timestamp: Date.now()
  });
}

function emitOrgEvent(io, orgId, event, payload) {
  if (!orgId || !event) return;
  const envelope = {
    orgId,
    event,
    payload: payload || {},
    timestamp: Date.now()
  };

  io.to(roomName(orgId)).emit(event, envelope);
  io.to(roomName(orgId)).emit("realtime:event", envelope);
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    writeJson(res, 204, { ok: true });
    return;
  }

  const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && parsedUrl.pathname === "/health") {
    writeJson(res, 200, { ok: true, service: "realtime", uptime: process.uptime() });
    return;
  }

  if (req.method === "POST" && parsedUrl.pathname === "/emit") {
    if (emitToken) {
      const headerToken = safeString(req.headers["x-realtime-token"], "");
      if (headerToken !== emitToken) {
        writeJson(res, 401, { ok: false, message: "Unauthorized realtime emitter token." });
        return;
      }
    }

    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk.toString();
    });

    req.on("end", () => {
      try {
        const body = rawBody ? JSON.parse(rawBody) : {};
        const orgId = safeString(body.orgId, "");
        const event = safeString(body.event, "");
        const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

        if (!orgId || !event) {
          writeJson(res, 400, { ok: false, message: "orgId and event are required." });
          return;
        }

        emitOrgEvent(io, orgId, event, payload);
        const room = io.sockets.adapter.rooms.get(roomName(orgId));
        writeJson(res, 202, {
          ok: true,
          deliveredTo: room ? room.size : 0
        });
      } catch (error) {
        writeJson(res, 400, {
          ok: false,
          message: error instanceof Error ? error.message : "Invalid JSON body."
        });
      }
    });
    return;
  }

  writeJson(res, 404, { ok: false, message: "Not found." });
});

const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  socket.on("org:join", (payload) => {
    const orgId = safeString(payload?.orgId, "");
    if (!orgId) return;

    const user = normalizeUser(payload?.user);
    socket.data.orgId = orgId;
    socket.data.userId = user.id;
    socket.join(roomName(orgId));

    const orgPresence = ensureOrgPresence(orgId);
    orgPresence.set(socket.id, user);
    publishPresence(io, orgId);
  });

  socket.on("signature:capture", (payload) => {
    const orgId = safeString(payload?.orgId, safeString(socket.data.orgId, ""));
    if (!orgId) return;

    emitOrgEvent(io, orgId, "signature.captured", {
      senderId: safeString(payload?.senderId, ""),
      approvalsProvided:
        typeof payload?.approvalsProvided === "number" ? payload.approvalsProvided : null,
      requiredSignatures:
        typeof payload?.requiredSignatures === "number" ? payload.requiredSignatures : null
    });
  });

  socket.on("disconnect", () => {
    const orgId = safeString(socket.data.orgId, "");
    if (!orgId) return;

    const orgPresence = ensureOrgPresence(orgId);
    orgPresence.delete(socket.id);
    publishPresence(io, orgId);
  });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[realtime] socket server listening on :${port}`);
});
