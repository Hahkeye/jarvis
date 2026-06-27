const ws = new WebSocket('ws://localhost:3000/ws');
let connected = false;

ws.onopen = () => {
  console.log('Connected');
  connected = true;
};

ws.onmessage = (event) => {
  console.log('Message:', event.data);
};

ws.onerror = (e) => {
  console.error('Error:', e.message || 'Unknown');
};

ws.onclose = (e) => {
  console.log('Closed:', e.code, e.reason);
  process.exit(0);
};

// Just wait, don't send any message
setTimeout(() => {
  if (connected) {
    console.log('Connection stable after 5 seconds');
  }
  ws.close();
  process.exit(0);
}, 5000);
