let ws;
let typingEl;
let reconnectTimer;
let isProcessing = false;

const messagesEl = document.getElementById("messages");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const micBtn = document.getElementById("micBtn");
const statusEl = document.querySelector(".status");
const themeToggle = document.getElementById("themeToggle");

// --- Theme Toggle ---
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("jarvis-theme", theme);
  themeToggle.textContent = theme === "light" ? "☀️" : "🌙";
}

(function initTheme() {
  const saved = localStorage.getItem("jarvis-theme");
  if (saved) {
    applyTheme(saved);
  } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
    applyTheme("light");
  }
})();

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "light" ? "dark" : "light");
});

// --- Toast Notifications ---
let toastContainer = document.createElement("div");
toastContainer.className = "toast-container";
document.body.appendChild(toastContainer);

function showToast(message, type, duration) {
  if (duration === undefined) duration = 6000;
  const toast = document.createElement("div");
  toast.className = "toast toast-" + type;
  toast.innerHTML = '<span class="toast-icon">' + (type === "timer" ? "⏰" : "🔔") + '</span><span class="toast-message">' + message + '</span><button class="toast-close">&times;</button>';
  toastContainer.appendChild(toast);

  toast.querySelector(".toast-close").addEventListener("click", () => {
    toast.classList.add("toast-exit");
    setTimeout(() => toast.remove(), 300);
  });

  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add("toast-exit");
      setTimeout(() => toast.remove(), 300);
    }
  }, duration);

  // Try browser notification
  if (Notification.permission === "granted") {
    new Notification("Jarvis", { body: message });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") new Notification("Jarvis", { body: message });
    });
  }
}

// --- Speech Recognition ---
let recognition = null;
let isListening = false;

function setupSpeechRecognition() {
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
    micBtn.style.display = "none";
    return;
  }

  recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    let interimTranscript = "";
    let finalTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    if (finalTranscript) {
      input.value = finalTranscript;
    } else if (interimTranscript) {
      input.placeholder = "Listening... " + interimTranscript;
    }
  };

  recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove("listening");
    input.placeholder = "Ask me anything...";
  };

  recognition.onerror = (event) => {
    isListening = false;
    micBtn.classList.remove("listening");
    input.placeholder = "Ask me anything...";
    if (event.error !== "aborted") {
      console.error("Speech recognition error:", event.error);
    }
  };
}

function toggleListening() {
  if (!recognition) return;

  if (isListening) {
    recognition.stop();
    isListening = false;
    micBtn.classList.remove("listening");
  } else {
    input.value = "";
    recognition.start();
    isListening = true;
    micBtn.classList.add("listening");
  }
}

// --- Core ---
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function renderMarkdown(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\n/g, "<br>")
    .replace(/\[([\s\S]*?)\]\((\S+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function setStatus(text, className) {
  statusEl.textContent = text;
  statusEl.className = "status " + className;
}

function setDisabled(disabled) {
  input.disabled = disabled;
  sendBtn.disabled = disabled;
  if (disabled) {
    sendBtn.textContent = "Stop";
    sendBtn.onclick = stopGeneration;
  } else {
    sendBtn.textContent = "Send";
    sendBtn.onclick = null;
  }
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(role, content, animate) {
  if (animate === undefined) animate = false;
  const el = document.createElement("div");
  el.className = "message " + role;
  if (role === "user") {
    el.innerHTML = renderMarkdown(content);
  } else if (animate && role === "assistant") {
    el.textContent = content;
  } else {
    el.innerHTML = renderMarkdown(content);
  }
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function showTyping() {
  if (typingEl) return;
  typingEl = document.createElement("div");
  typingEl.className = "message typing";
  typingEl.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(typingEl);
  scrollToBottom();
}

function hideTyping() {
  if (typingEl) {
    typingEl.remove();
    typingEl = null;
  }
}

function stopGeneration() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close(4999, "User stopped generation");
  }
  isProcessing = false;
  setDisabled(false);
  hideTyping();
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    setStatus("Connected", "connected");
    clearTimeout(reconnectTimer);
    if (!isProcessing) setDisabled(false);
  };

  ws.onclose = () => {
    setStatus("Disconnected", "disconnected");
    isProcessing = false;
    setDisabled(true);
    hideTyping();
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    setStatus("Connection error", "disconnected");
    isProcessing = false;
    hideTyping();
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "typing") {
        isProcessing = true;
        setDisabled(true);
        showTyping();
      } else if (data.type === "chunk") {
        hideTyping();
        let lastEl = messagesEl.lastElementChild;
        if (!lastEl || !lastEl.classList.contains("assistant")) {
          lastEl = addMessage("assistant", "", true);
        }
        lastEl.textContent += data.content;
        scrollToBottom();
      } else if (data.type === "done") {
        isProcessing = false;
        setDisabled(false);
        const lastEl = messagesEl.lastElementChild;
        if (lastEl && lastEl.classList.contains("assistant")) {
          const text = lastEl.textContent;
          lastEl.innerHTML = renderMarkdown(text);
        }
        scrollToBottom();
      } else if (data.type === "notification") {
        // Timer or reminder fired
        showToast(
          data.taskType === "timer"
            ? "Timer done! " + data.message
            : "Reminder: " + data.message,
          data.taskType,
        );
      }
    } catch {
      // ignore
    }
  };
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN || isProcessing) return;

  addMessage("user", text);
  input.value = "";
  ws.send(JSON.stringify({ role: "user", content: text }));
});

micBtn.addEventListener("click", toggleListening);

setupSpeechRecognition();
connect();
