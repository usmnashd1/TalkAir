(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const elements = {
    overlay: $("#appOverlay"),
    setupView: $("#setupView"),
    callView: $("#callView"),
    closeApp: $("#closeApp"),
    joinButton: $("#joinButton"),
    joinLabel: $("#joinLabel"),
    topicPicker: $("#topicPicker"),
    topicSelect: $("#topicSelect"),
    connectionDot: $("#connectionDot"),
    connectionLabel: $("#connectionLabel"),
    callMode: $("#callMode"),
    callTimer: $("#callTimer"),
    callAvatar: $("#callAvatar"),
    avatarText: $("#avatarText"),
    searchRadar: $("#searchRadar"),
    liveWave: $("#liveWave"),
    peerName: $("#peerName"),
    peerMeta: $("#peerMeta"),
    muteButton: $("#muteButton"),
    nextButton: $("#nextButton"),
    reportButton: $("#reportButton"),
    remoteAudio: $("#remoteAudio"),
    messageForm: $("#messageForm"),
    messageInput: $("#messageInput"),
    messages: $("#messages"),
    chatPanel: $(".chat-panel"),
    mobileChatButton: $("#mobileChatButton"),
    toggleChat: $("#toggleChat"),
    unreadBadge: $("#unreadBadge"),
    toast: $("#toast"),
    onlineCount: $("#onlineCount")
  };

  const aliases = ["Nova", "Echo", "Lumi", "Atlas", "Sage", "Mika", "Orion", "Ari", "Remi", "Sol"];
  const places = ["Across the world", "Language learner", "Study partner", "Curious mind", "Here to connect"];
  const colors = [
    ["#7d6af2", "#b38fff"], ["#148b9d", "#67e9d3"], ["#d1617b", "#f5a990"],
    ["#3568ad", "#79b6ff"], ["#75529c", "#de98ff"]
  ];

  const state = {
    mode: "random",
    socket: null,
    stream: null,
    peer: null,
    pendingCandidates: [],
    matched: false,
    startedAt: null,
    timerId: null,
    unread: 0,
    toastId: null,
    closing: false
  };

  function setMode(mode) {
    state.mode = mode;
    $$("[data-setup-mode]").forEach((button) => {
      button.classList.toggle("selected", button.dataset.setupMode === mode);
    });
    $$("[data-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === mode);
    });
    elements.topicPicker.hidden = mode === "random";
  }

  function openApp(mode = state.mode) {
    setMode(mode);
    elements.overlay.classList.add("open");
    elements.overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeApp() {
    state.closing = true;
    send({ type: "disconnect" });
    state.socket?.close();
    closePeer();
    stopMedia();
    clearTimer();
    state.socket = null;
    state.matched = false;
    resetCallUi();
    elements.callView.hidden = true;
    elements.setupView.hidden = false;
    elements.overlay.classList.remove("open");
    elements.overlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    state.closing = false;
  }

  function workerUrl() {
    const configured = window.TALKAIR_CONFIG?.websocketUrl?.trim();
    if (configured) return configured;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}/ws`;
  }

  function setConnection(label, online = false) {
    elements.connectionLabel.textContent = label;
    elements.connectionDot.classList.toggle("online", online);
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    clearTimeout(state.toastId);
    state.toastId = setTimeout(() => elements.toast.classList.remove("show"), 3200);
  }

  function send(payload) {
    if (state.socket?.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  async function join() {
    elements.joinButton.disabled = true;
    elements.joinLabel.textContent = "Requesting microphone...";
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
    } catch (error) {
      showToast(error.name === "NotAllowedError" ? "Microphone access was blocked. Please allow it to talk." : "We could not access your microphone.");
      elements.joinButton.disabled = false;
      elements.joinLabel.textContent = "Allow mic & find a match";
      return;
    }

    elements.setupView.hidden = true;
    elements.callView.hidden = false;
    elements.callMode.textContent = modeLabel();
    setSearching("Opening a secure connection...");
    connectSocket();
  }

  function connectSocket() {
    setConnection("Connecting", false);
    try {
      state.socket = new WebSocket(workerUrl());
    } catch {
      handleSocketFailure();
      return;
    }

    const timeout = setTimeout(() => {
      if (state.socket?.readyState !== WebSocket.OPEN) state.socket?.close();
    }, 8000);

    state.socket.addEventListener("open", () => {
      clearTimeout(timeout);
      setConnection("Network ready", true);
    });

    state.socket.addEventListener("message", async ({ data }) => {
      let message;
      try { message = JSON.parse(data); } catch { return; }
      try { await handleMessage(message); } catch (error) {
        console.error("TalkAir signaling error", error);
        showToast("The connection hit a snag. Finding a new match.");
        nextMatch();
      }
    });

    state.socket.addEventListener("close", () => {
      clearTimeout(timeout);
      if (!state.closing) handleSocketFailure();
    });

    state.socket.addEventListener("error", () => setConnection("Connection issue", false));
  }

  function handleSocketFailure() {
    setConnection("Offline", false);
    setSearching("Unable to reach the TalkAir network");
    elements.peerMeta.textContent = "Deploy the Worker or set websocketUrl in config.js";
    showToast("Signaling server unavailable. Check your Worker URL.");
  }

  async function handleMessage(message) {
    switch (message.type) {
      case "ready":
        send({ type: "join", mode: state.mode, topic: state.mode === "random" ? "" : elements.topicSelect.value });
        break;
      case "waiting":
        setSearching(message.position > 1 ? `You’re #${message.position} in the queue` : "Listening for someone great...");
        break;
      case "match_found":
        await startMatch(message);
        break;
      case "signal":
        await handleSignal(message.data);
        break;
      case "chat":
        addMessage(message.text, false);
        break;
      case "peer_left":
        showToast("Your match left. Finding someone new...");
        closePeer();
        clearTimer();
        state.matched = false;
        send({ type: "join", mode: state.mode, topic: state.mode === "random" ? "" : elements.topicSelect.value });
        break;
      case "reported":
        showToast("Report received. You won’t be matched together again.");
        break;
      case "pong":
        break;
      case "error":
        showToast(message.message || "Something went wrong.");
        break;
    }
  }

  async function startMatch(message) {
    closePeer();
    state.matched = true;
    const name = message.peer?.alias || aliases[Math.floor(Math.random() * aliases.length)];
    const initials = name.slice(0, 2).toUpperCase();
    const palette = colors[Math.floor(Math.random() * colors.length)];
    elements.callAvatar.style.background = `linear-gradient(145deg, ${palette[0]}, ${palette[1]})`;
    elements.avatarText.textContent = initials;
    elements.peerName.textContent = `Connected with ${name}`;
    elements.peerMeta.textContent = message.peer?.topic || places[Math.floor(Math.random() * places.length)];
    elements.searchRadar.hidden = true;
    elements.liveWave.hidden = false;
    setConnection("Peer connected", true);
    clearMessages();
    startTimer();
    const peer = createPeer();
    if (message.initiator) {
      await peer.setLocalDescription(await peer.createOffer());
      send({ type: "signal", data: { description: peer.localDescription } });
    }
  }

  function createPeer() {
    closePeer();
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    state.peer = peer;
    state.pendingCandidates = [];
    state.stream.getTracks().forEach((track) => peer.addTrack(track, state.stream));
    peer.addEventListener("icecandidate", ({ candidate }) => {
      if (candidate) send({ type: "signal", data: { candidate } });
    });
    peer.addEventListener("track", ({ streams }) => {
      elements.remoteAudio.srcObject = streams[0];
      elements.remoteAudio.play().catch(() => showToast("Tap the screen once to enable call audio."));
    });
    peer.addEventListener("connectionstatechange", () => {
      if (peer.connectionState === "connected") setConnection("Live & private", true);
      if (["failed", "disconnected"].includes(peer.connectionState) && state.matched) {
        setTimeout(() => {
          if (["failed", "disconnected"].includes(peer.connectionState)) nextMatch();
        }, 2200);
      }
    });
    return peer;
  }

  async function handleSignal(data) {
    const peer = state.peer || createPeer();
    if (data.description) {
      await peer.setRemoteDescription(data.description);
      while (state.pendingCandidates.length) await peer.addIceCandidate(state.pendingCandidates.shift());
      if (data.description.type === "offer") {
        await peer.setLocalDescription(await peer.createAnswer());
        send({ type: "signal", data: { description: peer.localDescription } });
      }
      return;
    }
    if (data.candidate) {
      if (peer.remoteDescription) await peer.addIceCandidate(data.candidate);
      else state.pendingCandidates.push(data.candidate);
    }
  }

  function closePeer() {
    state.pendingCandidates = [];
    elements.remoteAudio.srcObject = null;
    if (state.peer) {
      state.peer.ontrack = null;
      state.peer.onicecandidate = null;
      state.peer.close();
      state.peer = null;
    }
  }

  function stopMedia() {
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  function nextMatch() {
    closePeer();
    clearTimer();
    state.matched = false;
    clearMessages();
    setSearching("Finding a fresh voice...");
    send({ type: "next", mode: state.mode, topic: state.mode === "random" ? "" : elements.topicSelect.value });
  }

  function setSearching(label) {
    elements.avatarText.textContent = "?";
    elements.callAvatar.style.background = "linear-gradient(145deg, #252c42, #3a4055)";
    elements.peerName.textContent = label;
    elements.peerMeta.textContent = state.mode === "random" ? "Matching you with someone available" : `Matching by ${elements.topicSelect.value}`;
    elements.searchRadar.hidden = false;
    elements.liveWave.hidden = true;
    elements.callTimer.textContent = "00:00";
  }

  function resetCallUi() {
    elements.muteButton.classList.remove("muted");
    $("small", elements.muteButton).textContent = "Mute";
    elements.chatPanel.classList.remove("open");
    setConnection("Getting ready", false);
    clearMessages();
    setSearching("Searching the airwaves...");
    elements.joinButton.disabled = false;
    elements.joinLabel.textContent = "Allow mic & find a match";
  }

  function toggleMute() {
    const track = state.stream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    elements.muteButton.classList.toggle("muted", !track.enabled);
    $("small", elements.muteButton).textContent = track.enabled ? "Mute" : "Unmute";
    showToast(track.enabled ? "Microphone on" : "Microphone muted");
  }

  function reportPeer() {
    if (!state.matched) return showToast("There is no active match to report.");
    if (!window.confirm("Report this person and move to the next match?")) return;
    send({ type: "report", reason: "user_report" });
    nextMatch();
  }

  function modeLabel() {
    if (state.mode === "study") return `Study · ${elements.topicSelect.value}`;
    if (state.mode === "teach") return `Teach · ${elements.topicSelect.value}`;
    return "Random talk";
  }

  function startTimer() {
    clearTimer();
    state.startedAt = Date.now();
    state.timerId = setInterval(() => {
      const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
      const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
      const secs = String(seconds % 60).padStart(2, "0");
      elements.callTimer.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  function clearTimer() {
    clearInterval(state.timerId);
    state.timerId = null;
    state.startedAt = null;
  }

  function addMessage(text, self) {
    const wrapper = document.createElement("div");
    wrapper.className = `message${self ? " self" : ""}`;
    const body = document.createElement("p");
    body.textContent = text;
    const time = document.createElement("small");
    time.textContent = self ? "You · now" : "Match · now";
    wrapper.append(body, time);
    elements.messages.append(wrapper);
    elements.messages.scrollTop = elements.messages.scrollHeight;
    if (!self && !elements.chatPanel.classList.contains("open") && matchMedia("(max-width: 720px)").matches) {
      state.unread += 1;
      elements.unreadBadge.textContent = state.unread;
      elements.unreadBadge.hidden = false;
    }
  }

  function clearMessages() {
    $$(".message", elements.messages).forEach((message) => message.remove());
    state.unread = 0;
    elements.unreadBadge.hidden = true;
  }

  function openChat() {
    elements.chatPanel.classList.add("open");
    state.unread = 0;
    elements.unreadBadge.hidden = true;
    setTimeout(() => elements.messageInput.focus(), 250);
  }

  $$('[data-start]').forEach((button) => button.addEventListener("click", () => openApp()));
  $$("[data-mode]").forEach((button) => button.addEventListener("click", () => openApp(button.dataset.mode)));
  $$("[data-setup-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.setupMode)));
  elements.closeApp.addEventListener("click", closeApp);
  elements.joinButton.addEventListener("click", join);
  elements.muteButton.addEventListener("click", toggleMute);
  elements.nextButton.addEventListener("click", nextMatch);
  elements.reportButton.addEventListener("click", reportPeer);
  elements.mobileChatButton.addEventListener("click", openChat);
  elements.toggleChat.addEventListener("click", () => elements.chatPanel.classList.remove("open"));
  $("#exploreButton").addEventListener("click", () => $("#how-it-works").scrollIntoView({ behavior: "smooth" }));
  elements.topicSelect.addEventListener("change", () => { elements.callMode.textContent = modeLabel(); });
  elements.messageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = elements.messageInput.value.trim();
    if (!text) return;
    if (!state.matched) return showToast("Wait until you’re matched to send a message.");
    if (send({ type: "chat", text })) {
      addMessage(text, true);
      elements.messageInput.value = "";
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && elements.overlay.classList.contains("open")) closeApp();
  });
  window.addEventListener("beforeunload", () => {
    send({ type: "disconnect" });
    stopMedia();
  });

  const baseCount = 2847;
  setInterval(() => {
    const drift = Math.floor(Math.random() * 13) - 6;
    const current = Number(elements.onlineCount.textContent.replace(",", "")) || baseCount;
    elements.onlineCount.textContent = Math.max(1800, current + drift).toLocaleString();
  }, 5000);
})();
