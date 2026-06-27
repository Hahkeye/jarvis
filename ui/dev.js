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
    console.log("[DEV] Received message:", data.type || data.role, data);
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

// Direct tool call (bypasses AI)
function callTool(toolName, toolArgs = {}) {
  console.log(`[DEV] Calling tool: ${toolName}`, toolArgs);
  ws.send(JSON.stringify({
    type: "tool_call",
    tool: toolName,
    toolArgs: toolArgs,
  }));
}

// Tool Event Handler
function handleToolEvent(event) {
  console.log("[DEV] handleToolEvent called:", event);
  if (event.type !== "tool_result") return;

  switch (event.tool) {
    case "list_projects":
      console.log("[DEV] Rendering projects:", event.result);
      renderProjects(event.result);
      break;
    case "create_project":
      logToTerminal(`✓ Created project "${event.result.name}" with ${event.result.template} template`);
      loadProjects(); // Refresh list after creating
      break;
    case "select_project":
      // Navigation already handled by openProject(), just log silently
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
function loadProjects() {
  currentProject = null;
  projectBadge.textContent = "No project";
  callTool("list_projects");
}

function openProject(projectName) {
  console.log("[DEV] Opening project:", projectName);
  currentProject = projectName;
  projectBadge.textContent = projectName;
  projectListView.style.display = "none";
  projectView.style.display = "flex";
  currentFileName.textContent = "Select a file";
  codeEditor.value = "// Select a file to edit";
  saveBtn.disabled = true;
  fileList.innerHTML = '<div class="file-item">Loading...</div>';
  
  callTool("select_project", { name: projectName });
  callTool("list_project_files", { directory: "." });
}

function renderProjects(projects) {
  console.log("[DEV] renderProjects called with:", projects);
  projectListView.style.display = "block";
  projectView.style.display = "none";
  
  if (!projects || projects.length === 0) {
    projectGrid.innerHTML = "";
    emptyProjects.style.display = "block";
    return;
  }
  
  emptyProjects.style.display = "none";
  projectGrid.innerHTML = projects.map(p => `
    <div class="project-card ${p.active ? "active" : ""}" data-name="${p.name}">
      <h3>${p.name}</h3>
      ${p.description ? `<p>${p.description}</p>` : ""}
      <div class="project-meta">
        <span>${p.created}</span>
        <span>${p.fileCount || 0} files</span>
      </div>
    </div>
  `).join("");
  
  // Add click handlers to navigate into projects
  document.querySelectorAll(".project-card").forEach(card => {
    card.addEventListener("click", () => {
      const name = card.dataset.name;
      openProject(name);
    });
  });
}

function renderFiles(result) {
  
  let files = [];
  if (Array.isArray(result)) {
    // Structured result from tool_result event
    files = result;
  } else if (typeof result === "string") {
    // Legacy: parse text response
    const lines = result.split("\n").filter(l => l.trim());
    files = lines.map(line => {
      const match = line.match(/([\ud83d\udcbc\ud83d\udcc1])\s+(.+)/);
      if (match) {
        return { name: match[2], path: match[2] };
      }
      return null;
    }).filter(Boolean);
  }
  
  if (files.length === 0) {
    fileList.innerHTML = '<div class="file-item">No files found</div>';
    return;
  }
  
  fileList.innerHTML = files.map(f => `
    <div class="file-item ${f.name === currentFile?.name ? "active" : ""}" data-name="${f.name}">
      <span class="file-icon">${f.type === "directory" ? "📁" : "📄"}</span>
      <span>${f.name}</span>
      ${f.size ? `<span class="file-size">${f.size}</span>` : ""}
    </div>
  `).join("");
  
  // Add click handlers
  fileList.querySelectorAll(".file-item").forEach(item => {
    item.addEventListener("click", () => {
      const name = item.dataset.name;
      readFile(name);
    });
  });
}

function readFile(name) {
  currentFile = name;
  currentFileName.textContent = name;
  
  // Update active state in file list
  fileList.querySelectorAll(".file-item").forEach(item => {
    item.classList.toggle("active", item.dataset.name === name);
  });
  
  // Direct tool call to read file
  callTool("read_project_file", { filePath: name });
}

function saveFile() {
  if (!currentFile || !codeEditor.value) return;
  
  const content = codeEditor.value;
  callTool("write_project_file", { filePath: currentFile, content: content });
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
  
  callTool("create_project", { name, description, template });
  
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
