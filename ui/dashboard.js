let ws;
let typingEl;
let reconnectTimer;
let isProcessing = false;

const messagesEl = document.getElementById("messages");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const micBtn = document.getElementById("micBtn");
const statusEl = document.getElementById("status");
const timerListEl = document.getElementById("timerList");
const reminderListEl = document.getElementById("reminderList");
const weatherCardEl = document.getElementById("weatherCard");
const toastContainerEl = document.getElementById("toastContainer");

// --- State (backed by structured events) ---
let activeTimers = [];
let activeReminders = [];
let weatherData = null;

// --- Toast Notifications ---
function showToast(message, type, duration) {
  if (duration === undefined) duration = 6000;
  const icon = type === "timer" ? "⏰" : type === "error" ? "⚠️" : "🔔";
  const toast = document.createElement("div");
  toast.className = "toast toast-" + type;
  toast.innerHTML = '<span class="toast-icon">' + icon + '</span><span class="toast-message">' + escapeHtml(message) + '</span><button class="toast-close">&times;</button>';
  toastContainerEl.appendChild(toast);

  // Play audio alert
  playAlert();

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

  if (Notification.permission === "granted") {
    new Notification("Jarvis", { body: message });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") new Notification("Jarvis", { body: message });
    });
  }
}

// --- Audio Alert ---
function playAlert() {
  // Try Web Audio API first
  try {
    const AudioCtx = window.AudioContext || window["webkitAudioContext"] || null;
    if (!AudioCtx) return;
    const audioCtx = new AudioCtx();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = "sine";
    gainNode.gain.value = 0.3;
    
    oscillator.start();
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    oscillator.stop(audioCtx.currentTime + 0.5);
  } catch (e) {
    console.warn("Audio alert failed:", e);
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

// --- Core Helpers ---
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

// --- Dashboard: Render ---
function formatRemaining(triggerTime) {
  const remaining = Math.max(0, triggerTime - Date.now());
  const hours = Math.floor(remaining / 3600000);
  const mins = Math.floor((remaining % 3600000) / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function formatElapsed(createdAt) {
  const elapsed = Math.floor((Date.now() - createdAt) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return `${mins}m ${secs}s`;
}

function updateTimerList() {
  if (activeTimers.length === 0) {
    timerListEl.innerHTML = '<p class="empty">No active timers</p>';
    return;
  }

  timerListEl.innerHTML = activeTimers.map((t) => {
    const remaining = formatRemaining(t.triggerTime);
    const elapsed = formatElapsed(t.createdAt);
    const pct = Math.max(0, Math.min(100, ((t.triggerTime - Date.now()) / (t.triggerTime - t.createdAt)) * 100));
    return `
      <div class="task-item timer-item" data-id="${t.id}">
        <div class="task-item-info">
          <div class="task-item-label">${escapeHtml(t.label || "Timer")}</div>
          <div class="task-item-time">⏱ ${remaining} left</div>
        </div>
        <button class="task-item-cancel" onclick="cancelTask('${t.id}')" title="Cancel">✕</button>
        <div class="progress-bar" style="width:${pct}%"></div>
      </div>
    `;
  }).join("");
}

function updateReminderList() {
  if (activeReminders.length === 0) {
    reminderListEl.innerHTML = '<p class="empty">No active reminders</p>';
    return;
  }

  reminderListEl.innerHTML = activeReminders.map((r) => {
    const remaining = formatRemaining(r.triggerTime);
    return `
      <div class="task-item" data-id="${r.id}">
        <div class="task-item-info">
          <div class="task-item-label">${escapeHtml(r.label)}</div>
          <div class="task-item-time">📅 ${escapeHtml(r.triggerFormatted)} (${remaining})</div>
        </div>
        <button class="task-item-cancel" onclick="cancelTask('${r.id}')" title="Cancel">✕</button>
      </div>
    `;
  }).join("");
}

function updateWeather() {
  if (!weatherData) return;
  weatherCardEl.innerHTML = `
    <div class="temp">${weatherData.temp}°${weatherData.unit}</div>
    <div class="details">${escapeHtml(weatherData.condition)} · ${weatherData.humidity}% humidity · ${weatherData.wind} km/h</div>
    <div class="location">📍 ${escapeHtml(weatherData.location)}</div>
  `;
}

// --- Structured Event Handlers ---
function handleToolEvent(event) {
  const { tool, result } = event;

  switch (tool) {
    case "set_timer":
      activeTimers.push({
        id: result.id,
        label: result.label,
        createdAt: Date.now(),
        triggerTime: result.triggerTime,
      });
      updateTimerList();
      break;

    case "set_reminder":
      activeReminders.push({
        id: result.id,
        label: result.label,
        triggerTime: result.triggerTime,
        triggerFormatted: result.triggerFormatted,
      });
      updateReminderList();
      break;

    case "cancel_task":
      activeTimers = activeTimers.filter(t => t.id !== result.id);
      activeReminders = activeReminders.filter(r => r.id !== result.id);
      updateTimerList();
      updateReminderList();
      break;

    case "list_tasks":
      // Full sync from server state
      activeTimers = result.timers.map(t => ({
        id: t.id,
        label: t.label,
        createdAt: Date.now(),
        triggerTime: t.triggerTime,
      }));
      activeReminders = result.reminders.map(r => ({
        id: r.id,
        label: r.label,
        triggerTime: r.triggerTime,
        triggerFormatted: r.triggerFormatted,
      }));
      updateTimerList();
      updateReminderList();
      break;

    case "get_weather":
      weatherData = result;
      updateWeather();
      break;

    case "web_search":
      // Could add a search results widget in the future
      break;
  }
}

// Make cancelTask globally accessible
window.cancelTask = function(id) {
  askAI(`Cancel task ${id}`);
};

window.askAI = function(text) {
  if (!text) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast("WebSocket not connected. Please refresh the page.", "error", 4000);
    return;
  }
  if (isProcessing) {
    showToast("Please wait for the current response to finish.", "error", 3000);
    return;
  }
  addMessage("user", text);
  input.value = "";
  ws.send(JSON.stringify({ role: "user", content: text }));
};

// --- WebSocket ---
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

  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
    setStatus("Connection error — check console", "disconnected");
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

      } else if (data.type === "tool_result") {
        // Structured event — update dashboard widgets
        handleToolEvent(data);

      } else if (data.type === "notification") {
        const msg = data.taskType === "timer"
          ? "Timer done! " + data.message
          : "Reminder: " + data.message;
        showToast(msg, data.taskType);
        activeTimers = activeTimers.filter(t => t.id !== data.id);
        activeReminders = activeReminders.filter(r => r.id !== data.id);
        updateTimerList();
        updateReminderList();
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

// --- Settings Modal ---
const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettings = document.getElementById("closeSettings");
const cancelSettings = document.getElementById("cancelSettings");
const saveSettings = document.getElementById("saveSettings");
const providerSelect = document.getElementById("providerSelect");
const baseUrlInput = document.getElementById("baseUrl");
const apiKeyInput = document.getElementById("apiKey");
const modelInput = document.getElementById("model");
const settingsStatus = document.getElementById("settingsStatus");

async function loadPresets() {
  try {
    const res = await fetch("/api/config/presets");
    const presets = await res.json();
    providerSelect.innerHTML = "";
    presets.forEach((preset, idx) => {
      const opt = document.createElement("option");
      opt.value = idx;
      opt.textContent = `${preset.icon} ${preset.name}`;
      providerSelect.appendChild(opt);
    });
  } catch (e) {
    providerSelect.innerHTML = '<option value="">Error loading presets</option>';
  }
}

async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    const config = await res.json();
    baseUrlInput.value = config.baseUrl || "";
    apiKeyInput.value = config.apiKey || "";
    modelInput.value = config.model || "";
    
    const presets = providerSelect.options;
    let found = false;
    for (let i = 0; i < presets.length; i++) {
      if (presets[i].text === `${config.icon} ${config.name}`) {
        providerSelect.value = i;
        found = true;
        break;
      }
    }
    if (!found) providerSelect.value = "custom";
  } catch (e) {
    console.error("Failed to load config:", e);
  }
}

async function saveSettingsHandler() {
  saveSettings.disabled = true;
  settingsStatus.className = "settings-status";
  settingsStatus.textContent = "Saving...";
  settingsStatus.style.display = "block";

  const provider = {
    name: providerSelect.value === "custom" ? "Custom" : providerSelect.options[providerSelect.value].text.replace(/^[\u{1F300}-\u{1FAFF}]\s*/u, "").trim(),
    baseUrl: baseUrlInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim(),
    icon: providerSelect.value === "custom" ? "⚙️" : providerSelect.options[providerSelect.value].text[0]
  };

  if (!provider.baseUrl || !provider.model) {
    settingsStatus.textContent = "Base URL and Model are required";
    settingsStatus.className = "settings-status error";
    saveSettings.disabled = false;
    return;
  }

  try {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(provider),
    });
    const saved = await res.json();
    settingsStatus.textContent = `✅ Saved: ${saved.name} (${saved.baseUrl})`;
    settingsStatus.className = "settings-status success";
    
    setTimeout(() => {
      settingsModal.classList.remove("active");
    }, 1500);
  } catch (e) {
    settingsStatus.textContent = `❌ Failed: ${e.message}`;
    settingsStatus.className = "settings-status error";
  } finally {
    saveSettings.disabled = false;
  }
}

settingsBtn.addEventListener("click", () => {
  loadPresets();
  loadConfig();
  settingsModal.classList.add("active");
});

closeSettings.addEventListener("click", () => {
  settingsModal.classList.remove("active");
});

cancelSettings.addEventListener("click", () => {
  settingsModal.classList.remove("active");
});

saveSettings.addEventListener("click", saveSettingsHandler);

settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) {
    settingsModal.classList.remove("active");
  }
});

// --- Timer countdown updater ---
setInterval(() => {
  if (activeTimers.length > 0) {
    updateTimerList();
  }
  if (activeReminders.length > 0) {
    updateReminderList();
  }
}, 1000);

setupSpeechRecognition();
connect();
