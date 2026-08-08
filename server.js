const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_HOST = process.env.PUBLIC_HOST || "";
const PUBLIC_DIR = path.join(__dirname, "public");
const USE_HTTPS = fs.existsSync(path.join(__dirname, "key.pem")) && fs.existsSync(path.join(__dirname, "cert.pem"));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function requestHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  if (pathname === "/config.js") {
    const base = PUBLIC_HOST ? `${USE_HTTPS ? "https" : "http"}://${PUBLIC_HOST}` : `${USE_HTTPS ? "https" : "http"}://${req.headers.host}`;
    let turn = null;
    if (process.env.TURN_URL) {
      const urls = process.env.TURN_URL.split(",").map((s) => s.trim()).filter(Boolean);
      turn = urls.map((u) => ({
        urls: u,
        username: process.env.TURN_USER || "",
        credential: process.env.TURN_PASS || "",
      }));
    }
    res.writeHead(200, { "Content-Type": "text/javascript" });
    res.end(
      `window.APP_BASE_URL = ${JSON.stringify(base)};\n` +
      `window.APP_TURN = ${JSON.stringify(turn)};`
    );
    return;
  }

  const filePath = path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

let server;
if (USE_HTTPS) {
  server = https.createServer(
    {
      key: fs.readFileSync(path.join(__dirname, "key.pem")),
      cert: fs.readFileSync(path.join(__dirname, "cert.pem")),
    },
    requestHandler
  );
} else {
  server = http.createServer(requestHandler);
}

const wss = new WebSocketServer({ server });
const rooms = new Map();

function getIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "";
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function leaveRoom(ws) {
  if (!ws.room) return;
  const room = rooms.get(ws.room);
  if (room) {
    room.forEach((peer) => {
      if (peer !== ws && peer.readyState === peer.OPEN) {
        send(peer, { type: "peer-left" });
      }
    });
    room.delete(ws);
    if (room.size === 0) rooms.delete(ws.room);
  }
  ws.room = null;
}

wss.on("connection", (ws, req) => {
  ws.ip = getIp(req);
  ws.room = null;

  ws.on("message", (raw) => {
    handleMessage(ws, raw);
  });

  ws.on("close", () => {
    leaveRoom(ws);
  });
});

function handleMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }

  if (msg.type === "join") {
    const roomId = String(msg.room || "").slice(0, 64);
    if (!roomId) return;
    const publicIp = String(msg.publicIp || "").slice(0, 45);
    leaveRoom(ws);
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    const room = rooms.get(roomId);
    ws.room = roomId;
    ws.publicIp = publicIp || ws.ip;
    room.add(ws);

    const peers = [...room].filter((p) => p !== ws);
    send(ws, {
      type: "joined",
      you: ws.publicIp,
      initiator: peers.length === 0,
      peers: peers.map((p) => p.publicIp),
    });
    peers.forEach((peer) => {
      send(peer, { type: "peer-joined", ip: ws.publicIp });
    });
  } else if (msg.type === "signal") {
    const room = rooms.get(ws.room);
    if (!room) return;
    room.forEach((peer) => {
      if (peer !== ws && peer.readyState === peer.OPEN) {
        send(peer, { type: "signal", from: ws.publicIp, data: msg.data });
      }
    });
  } else if (msg.type === "leave") {
    leaveRoom(ws);
  }
}

server.listen(PORT, HOST, () => {
  const proto = USE_HTTPS ? "https" : "http";
  console.log(`Video call server running on ${HOST}:${PORT} (${proto})`);
  const base = PUBLIC_HOST ? `${proto}://${PUBLIC_HOST}` : `${proto}://localhost:${PORT}`;
  console.log(`Shareable base URL: ${base}`);
});
