const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  console.log('Connected');
  // Send a test message after 1 second
  setTimeout(() => {
    console.log('Sending message...');
    ws.send(JSON.stringify({ role: 'user', content: 'hello' }));
  }, 1000);
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

// Keep connection open for 10 seconds
setTimeout(() => {
  console.log('Timeout');
  ws.close();
  process.exit(0);
}, 10000);
