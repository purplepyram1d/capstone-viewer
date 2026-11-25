// One upstream live connection for all open windows using this snapshot size.
const light = new URL(self.location.href).searchParams.has('light');
const path = light ? '/api/live?light=1' : '/api/live';
const ports = new Set();
let stream = null;
let latest = null;
let latestPulse = null;
let lastMessage = 0;
let idleTimer = null;

function distribute(message) {
  for (const port of ports) port.postMessage(message);
}

function connect() {
  if (stream) return;
  stream = new EventSource(path);
  lastMessage = Date.now();
  for (const type of ['snapshot','pulse','heartbeat']) {
    stream.addEventListener(type, event => {
      lastMessage = Date.now();
      if (type==='heartbeat') return;
      const message = { type, data:event.data };
      if (type==='snapshot') {
        latest = message;
        latestPulse = null;
      } else latestPulse = message;
      distribute(message);
    });
  }
  stream.onerror = () => {
    latest = latestPulse = null;
    distribute({ type:'offline' });
  };
}

function stop() {
  stream?.close();
  stream = null;
  latest = latestPulse = null;
}

self.onconnect = event => {
  const port = event.ports[0];
  clearTimeout(idleTimer);
  ports.add(port);
  port.onmessage = event => {
    if (event.data !== 'leave') return;
    ports.delete(port);
    port.close();
    if (!ports.size) idleTimer = setTimeout(stop, 1000);
  };
  port.postMessage({ type:'ready' });
  if (latest) port.postMessage(latest);
  if (latestPulse) port.postMessage(latestPulse);
  connect();
};

setInterval(() => {
  if (!stream) return;
  const closed = stream.readyState === EventSource.CLOSED;
  const silent = stream.readyState === EventSource.OPEN && Date.now() - lastMessage >= 65_000;
  if (!closed && !silent) return;
  stop();
  distribute({ type:'offline' });
  if (ports.size) connect();
}, 10_000);
