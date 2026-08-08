(() => {
  const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.linode.com:3478" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ];

  const APP_BASE = (window.APP_BASE_URL || location.origin) + location.pathname;
  const lobby = $("lobby");
  const callScreen = $("call");
  const localVideo = $("localVideo");
  const remoteVideo = $("remoteVideo");

  let ws = null;
  let pc = null;
  let localStream = null;
  let myIp = "";
  let room = "";
  let isInitiator = false;

  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
    ws.onopen = () => log("WS connected");
    ws.onerror = (e) => log("WS error");
    ws.onclose = () => {
      if (callScreen.classList.contains("hidden")) return;
      log("WS closed");
    };
  }

  async function getPublicIp() {
    try {
      const r = await fetch("https://api.ipify.org?format=json");
      const j = await r.json();
      return j.ip;
    } catch {
      return "";
    }
  }

  async function startCall(roomId) {
    room = roomId;
    connect();

    const publicIp = await getPublicIp();
    myIp = publicIp || myIp;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", room, publicIp }));
      log("Joined room " + room);
    };
    showCall();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      appendPeer("getUserMedia unavailable (needs https or localhost)");
      return;
    }

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
      localVideo.play().catch(() => {});
      log("Camera/mic acquired");
    } catch (err) {
      appendPeer("Camera/mic error: " + (err && err.name ? err.name : err) + " — video disabled");
    }
  }

  function extractCandidateIp(cand) {
    try {
      const m = /candidate:\S+ \d+ \S+ \d+ (\S+) \d+ typ (\S+)/.exec(cand.candidate);
      if (m) return { ip: m[1], type: m[2] };
    } catch {}
    return null;
  }

  function reportLeakedIp(cand) {
    const info = extractCandidateIp(cand);
    if (!info) return;
    if (info.type === "srflx" || info.type === "relay" || info.type === "host") {
      const label = info.type === "srflx" ? "REAL PUBLIC IP (via STUN)" : info.type.toUpperCase();
      appendPeer(`${label}: ${info.ip}`);
      log(`${label} leaked: ${info.ip}`);
      if (info.type === "srflx" && !myIp) {
        myIp = info.ip;
        $("myIp").textContent = info.ip;
      }
    }
  }

  function createPeerConnection() {
    const config = { iceServers: ICE_SERVERS, iceCandidatePoolSize: 10 };
    pc = new RTCPeerConnection(config);
    if (localStream) {
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    }
    pc.ontrack = (e) => {
      remoteVideo.srcObject = e.streams[0];
      remoteVideo.play().catch(() => {});
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        reportLeakedIp(e.candidate);
        ws.send(JSON.stringify({ type: "signal", data: { candidate: e.candidate } }));
      }
    };
    };
    pc.oniceconnectionstatechange = () => log("ICE state: " + pc.iceConnectionState);
    pc.onconnectionstatechange = () => log("PC state: " + pc.connectionState);
    return pc;
  }

  async function handleMessage(msg) {
    if (msg.type === "joined") {
      myIp = msg.you;
      isInitiator = msg.initiator;
      $("myIp").textContent = myIp;
      $("roomId").textContent = room;
      log("Joined. Initiator=" + isInitiator);
      msg.peers.forEach((ip) => appendPeer(ip));
    } else if (msg.type === "peer-joined") {
      appendPeer(msg.ip);
      log("Peer joined: " + msg.ip);
      createPeerConnection();
      if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: "signal", data: { sdp: pc.localDescription } }));
        log("Sent offer");
      }
    } else if (msg.type === "signal") {
      if (!pc) createPeerConnection();
      const data = msg.data;
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        log("Got " + data.sdp.type);
        if (data.sdp.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(JSON.stringify({ type: "signal", data: { sdp: pc.localDescription } }));
          log("Sent answer");
        }
      } else if (data.candidate) {
        reportLeakedIp(data.candidate);
        try { await pc.addIceCandidate(data.candidate); } catch (e) {}
      }
    } else if (msg.type === "peer-left") {
      remoteVideo.srcObject = null;
      $("peers").innerHTML = "";
      log("Peer left");
    }
  }

  function appendPeer(ip) {
    const el = $("peers");
    if ([...el.children].some((c) => c.textContent === ip)) return;
    const div = document.createElement("div");
    div.textContent = ip;
    el.appendChild(div);
  }

  function log(msg) {
    const el = $("log");
    if (el) el.textContent += msg + "\n";
    console.log(msg);
  }

  function showCall() {
    lobby.classList.add("hidden");
    callScreen.classList.remove("hidden");
  }

  function hangUp() {
    if (ws) ws.send(JSON.stringify({ type: "leave" }));
    if (pc) pc.close();
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (ws) ws.close();
    location.href = location.pathname;
  }

  function genRoom() {
    return Math.random().toString(36).slice(2, 10);
  }

  $("createBtn").onclick = () => {
    const id = genRoom();
    const url = `${APP_BASE}?room=${id}`;
    $("shareLink").value = url;
    $("shareBox").classList.remove("hidden");
  };

  $("copyBtn").onclick = () => {
    navigator.clipboard.writeText($("shareLink").value);
  };

  $("hangupBtn").onclick = hangUp;

  const params = new URLSearchParams(location.search);
  const roomParam = params.get("room");
  if (roomParam) {
    startCall(roomParam);
  }
})();
