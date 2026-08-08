# Video Call (WebRTC + IP leak demo)

A link-based WebRTC video call. Each peer's **real public IP** is revealed to the
other side via STUN (the same mechanism WebRTC uses to bypass HTTP/SOCKS proxies).

## Run locally

```
npm install
npm start
```

Opens `https://localhost:3000` (self-signed cert — click past the warning).

## Host it publicly

The server binds `0.0.0.0` and reads env vars:

- `PORT`        — listen port (default 3000)
- `HOST`        — bind address (default 0.0.0.0)
- `PUBLIC_HOST` — the domain users will open, e.g. `vc.example.com`
                (used to build the shareable call link)

Example with a domain + reverse proxy (nginx/caddy handling TLS):

```
PORT=3000 PUBLIC_HOST=vc.example.com node server.js
```

If you let the app serve TLS directly (key.pem/cert.pem present), it uses HTTPS
and you must forward 443 → 3000 (or set `PORT=443`).

## Deploy to GitHub + free Node host (Render)

GitHub Pages CANNOT host this app (it only serves static files; this needs a
Node server + WebSocket signaling). Push the code to GitHub for storage, then
deploy the running server to a Node host.

### 1. Push to GitHub
```
git init
git add .
git commit -m "video call ip-leak app"
git remote add origin https://github.com/YOURUSER/videocall.git
git push -u origin main
```

### 2. Deploy on Render (free, gives public HTTPS)
- Go to https://render.com → New → Web Service → connect the GitHub repo.
- Build command: `npm install`
- Start command: `npm start`
- Add env var `PORT` (Render sets this automatically) and
  `PUBLIC_HOST` = the Render URL, e.g. `videocall.onrender.com`.
- Render provides HTTPS, so delete `key.pem`/`cert.pem` (the app falls back to
  plain HTTP, which Render's HTTPS proxy terminates). Do NOT commit certs.

### 3. Test the IP leak from your phone
- Open the Render URL on the phone (through its proxy).
- Create a call, open the link on another network.
- The screen shows your real public IP via ipify + STUN `srflx`.

The server location does NOT affect the leaked IP — ipify and STUN run in the
phone's own browser, so they reveal the phone's true public IP regardless of
where the signaling server is hosted.

## How the IP "bypass" works

1. On join, the browser fetches its public IP from `https://api.ipify.org`.
2. WebRTC builds a peer connection with public STUN servers
   (`stun:stun.l.google.com`, `stun:stun.cloudflare.com`, etc.).
3. STUN reflects back the device's **true NAT/public IP** as a `srflx` ICE
   candidate. That candidate is sent to the other peer regardless of any HTTP
   web proxy, because ICE/UDP media traffic is not routed through the browser's
   HTTP proxy.
4. Both the caller's public IP (from ipify) and the STUN-reflected `srflx` IP
   are displayed in the call screen.

### Limits (important)

- A **real VPN with full-tunnel routing** tunnels ALL traffic including UDP, so
  WebRTC will show the VPN's exit IP — it cannot be bypassed at the app layer.
  It bypasses HTTP/SOCKS *web* proxies that only intercept browser traffic.
- For calls between two different networks, STUN often is not enough (symmetric
  NAT). Add a TURN server (e.g. coturn) to relay media. The IP display still
  works without TURN.

## Files

- `server.js`        — HTTPS/HTTP server + WebSocket signaling
- `generate-cert.js` — creates self-signed key.pem/cert.pem (node-forge)
- `public/`          — frontend (index.html, style.css, client.js)
