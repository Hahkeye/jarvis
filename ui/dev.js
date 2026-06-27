// Development Mode JavaScript

const ws = new WebSocket(`wss://${window.location.host}/ws`);
let currentProject = null;
let currentFile = null;

// DOM Elements
const backBtn = document.getElementById("backBtn");
const projectBadge = document.getElementById("projectBadge");
const listProjectsBtn = document.getElementById("listProjectsBtn");
const createProjectBtn = document.getElementById("createProjectBtn");
const projectListView = document.getElementById("projectListView");
const projectView = document.getElementById("projectView");
const projectGrid = document.getElementById("projectGrid");
const emptyProjects = document.getElementById("emptyProjects");
const fileList = document.getElementById("fileList");
const currentFileName = document.getElementById("currentFileName");
const codeEditor = document.getElementById("codeEditor");
const saveBtn = document.getElementById("saveBtn");
const newFileBtn = document.getElementById("newFileBtn");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const terminalOutput = document.getElementById("terminalOutput");
const createProjectModal = document.getElementById("createProjectModal");
const createProjectForm = document.getElementById("createProjectForm");
const cancelCreateBtn = document.getElementById("cancelCreateBtn");

// WebSocket Message Handler
ws.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    handleToolEvent(data);
  } catch (e) {
    console.error("Failed to parse WebSocket message:", e);
  }
};

ws.onopen = () => {
  logToTerminal("Connected to server");
  loadProjects();
};

ws.onerror = (error) => {
  logToTerminal("WebSocket error", "error");
};

ws.onclose = () => {
  logToTerminal("Disconnected from server");
};

// --- Core Helpers ---
function sendMessage(msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// Tool Event Handler
function handleToolEvent(event) {
  if (event.type !== "tool_result") return;

  switch (event.tool) {
    case "list_projects":
      renderProjects(event.result);
      break;
    case "list_project_files":
      renderFiles(event.result);
      break;
    case "read_project_file":
      codeEditor.value = event.result;
      saveBtn.disabled = true;
      break;
    case "write_project_file":
      logToTerminal(`✓ ${event.result}`);
      saveBtn.disabled = true;
      break;
    default:
      logToTerminal(event.result);
  }
}

// Project Management
async function loadProjects() {
  sendMessage({
    role: "user",
    content: "List all my development projects",
  });
}

function renderProjects(projects) {
  projectListView.style.display = "block";
  projectView.style.display = "none";
  
  if (!projects || projects.length === 0) {
    projectGrid.innerHTML = "";
    emptyProjects.style.display = "block";
    return;
  }
  
  emptyProjects.style.display = "none";
  projectGrid.innerHTML = projects.map(p => `
    <div class="project-card ${p.name === currentProject?.name ? "active" : ""}" data-name="${p.name}">
      <h3>${p.name}</h3>
      ${p.description ? `<p>${p.description}</p>` : ""}
      <div class="project-meta">
        <span>${p.created}</span>
        <span>${p.fileCount || 0} files</span>
      </div>
    </div>
  `).join("");
  
  // Add click handlers
  document.querySelectorAll(".project-card").forEach(card => {
    card.addEventListener("click", () => {
      const name = card.dataset.name;
      selectProject(name);
    });
  });
}

async function selectProject(name) {
  sendMessage({
    role: "user",
    content: `Select project ${name}`,
  });
  
  currentProject = { name };
  projectBadge.textContent = name;
  projectListView.style.display = "none";
  projectView.style.display = "flex";
  
  loadFiles();
}

async function loadFiles() {
  sendMessage({
    role: "user",
    content: "List all files in the current project",
  });
}

function renderFiles(result) {
  if (typeof result === "string") {
    // Parse the text response
    const lines = result.split("\n").filter(l => l.trim());
    fileList.innerHTML = lines.map(line => {
      const match = line.match(/([📁📄])\s+(.+)/);
      if (match) {
        const icon = match[1];
        const name = match[2];
        const isActive = currentFile === name;
        return `<div class="file-item ${isActive ? "active" : ""}" data-name="${name}">${icon} ${name}</div>`;
      }
      return "";
    }).join("");
    
    // Add click handlers
    fileList.querySelectorAll(".file-item").forEach(item => {
      item.addEventListener("click", () => {
        const name = item.dataset.name;
        selectFile(name);
      });
    });
  }
}

async function selectFile(name) {
  currentFile = name;
  currentFileName.textContent = name;
  
  // Update active state in file list
  fileList.querySelectorAll(".file-item").forEach(item => {
    item.classList.toggle("active", item.dataset.name === name);
  });
  
  // Load file content
  sendMessage({
    role: "user",
    content: `Read the file ${name} from the current project`,
  });
}

async function saveFile() {
  if (!currentFile || !codeEditor.value) return;
  
  const content = codeEditor.value;
  sendMessage({
    role: "user",
    content: `Write the following content to ${currentFile} in the current project:\n\n${content}`,
  });
}

// Event Listeners
backBtn.addEventListener("click", () => {
  window.location.href = "/dashboard";
});

listProjectsBtn.addEventListener("click", loadProjects);

createProjectBtn.addEventListener("click", () => {
  createProjectModal.style.display = "flex";
});

cancelCreateBtn.addEventListener("click", () => {
  createProjectModal.style.display = "none";
});

createProjectForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("projectName").value;
  const description = document.getElementById("projectDescription").value;
  const template = document.getElementById("projectTemplate").value;
  
  sendMessage({
    role: "user",
    content: `Create a new project named ${name} with template ${template}. Description: ${description || "None"}`,
  });
  
  createProjectModal.style.display = "none";
  createProjectForm.reset();
});

newFileBtn.addEventListener("click", () => {
  const name = prompt("Enter file name:");
  if (name) {
    codeEditor.value = "";
    currentFile = name;
    currentFileName.textContent = name;
    saveBtn.disabled = false;
  }
});

saveBtn.addEventListener("click", saveFile);

runBtn.addEventListener("click", () => {
  const command = prompt("Enter command to run (e.g., 'npm start', 'bun dev'):");
  if (command) {
    logToTerminal(`$ ${command}`);
    // In a real implementation, this would execute the command via a backend API
    logToTerminal("Command executed (simulated)", "success");
  }
});

clearBtn.addEventListener("click", () => {
  terminalOutput.innerHTML = "";
});

codeEditor.addEventListener("input", () => {
  saveBtn.disabled = false;
});

// Utility Functions
function logToTerminal(message, type = "info") {
  const line = document.createElement("div");
  line.className = `terminal-line ${type}`;
  line.textContent = message;
  terminalOutput.appendChild(line);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}
