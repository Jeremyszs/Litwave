(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.WsTelemetry = api;
    // ponytail: top-level export simplifies migration; namespace when frontend moves to ES modules
    if (!root.createWsClient) root.createWsClient = api.createWsClient;
    if (!root.getWsUrl) root.getWsUrl = api.getWsUrl;
    if (!root.calculateBackoff) root.calculateBackoff = api.calculateBackoff;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function getWsUrl(path = "/ws") {
    if (typeof window === "undefined" || !window.location) return `ws://localhost${path}`;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}${path}`;
  }

  function calculateBackoff(attempt = 0, baseMs = 1000, maxMs = 10000, factor = 1.5) {
    const delay = Math.min(maxMs, baseMs * Math.pow(factor, Math.max(0, attempt)));
    const jitter = delay * 0.15 * (typeof Math.random === "function" ? Math.random() : 0);
    return Math.floor(delay + jitter);
  }

  function createWsClient(options = {}) {
    const {
      path = "/ws",
      url = null,
      onOpen = null,
      onClose = null,
      onError = null,
      onSocket = null,
      onMessage = null,
      handlers = {},
      autoConnect = true,
      minReconnectDelayMs = 1000,
      maxReconnectDelayMs = 10000,
      backoffFactor = 1.5
    } = options;

    let socket = null;
    let attempt = 0;
    let reconnectTimer = null;
    let explicitClose = false;

    function getCtor() {
      if (typeof window !== "undefined" && window.WebSocket) return window.WebSocket;
      if (typeof globalThis !== "undefined" && globalThis.WebSocket) return globalThis.WebSocket;
      if (typeof WebSocket !== "undefined") return WebSocket;
      return null;
    }

    function connect() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      explicitClose = false;
      const targetUrl = url || getWsUrl(path);

      const WebSocketCtor = getCtor();
      if (!WebSocketCtor) {
        return null;
      }

      try {
        socket = new WebSocketCtor(targetUrl);
      } catch (err) {
        scheduleReconnect();
        return null;
      }

      if (typeof onSocket === "function") {
        try {
          onSocket(socket);
        } catch (_) {}
      }

      socket.onopen = (evt) => {
        attempt = 0;
        if (typeof onOpen === "function") onOpen(evt, socket);
      };

      socket.onmessage = (evt) => {
        let msg = null;
        try {
          msg = typeof evt.data === "string" ? JSON.parse(evt.data) : evt.data;
        } catch (err) {
          console.error("WS message parse error:", err);
          return;
        }

        if (msg && typeof msg === "object" && msg.type && typeof handlers[msg.type] === "function") {
          try {
            handlers[msg.type](msg, evt);
          } catch (handlerErr) {
            console.error(`Error in WS handler for ${msg.type}:`, handlerErr);
          }
        } else if (typeof onMessage === "function") {
          try {
            onMessage(msg, evt);
          } catch (msgErr) {
            console.error("Error in WS onMessage:", msgErr);
          }
        }
      };

      socket.onerror = (evt) => {
        if (typeof onError === "function") onError(evt, socket);
      };

      socket.onclose = (evt) => {
        if (typeof onClose === "function") onClose(evt);
        if (!explicitClose) {
          scheduleReconnect();
        }
      };

      return socket;
    }

    function scheduleReconnect() {
      if (reconnectTimer || explicitClose) return;
      const delay = calculateBackoff(attempt++, minReconnectDelayMs, maxReconnectDelayMs, backoffFactor);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    }

    function close() {
      explicitClose = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket) {
        try { socket.close(); } catch (_) {}
        socket = null;
      }
    }

    if (autoConnect) {
      connect();
    }

    return {
      connect,
      close,
      getSocket: () => socket,
      getAttempt: () => attempt,
      isConnected: () => Boolean(socket && socket.readyState === 1)
    };
  }

  return {
    getWsUrl,
    calculateBackoff,
    createWsClient
  };
});
