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
const terminalInput = document.getElementById("terminalInput");
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
// Direct tool call (bypasses AI)
function callTool(toolName, toolArgs = {}) {
  ws.send(JSON.stringify({
    type: "tool_call",
    tool: toolName,
    toolArgs: toolArgs,
  }));
}

// Tool Event Handler
function handleToolEvent(event) {
  if (event.type !== "tool_result") return;

  switch (event.tool) {
    case "list_projects":
      renderProjects(event.result);
      break;
    case "create_project":
      logToTerminal(`Created project "${event.result.name}" with ${event.result.template} template`);
      loadProjects(); // Refresh list after creating
      break;
    case "delete_project":
      logToTerminal(`Deleted project "${event.result.replace(/"/g, "")}"`);
      loadProjects(); // Refresh list after deleting
      break;
    case "select_project":
      // Navigation already handled by openProject()
      break;
    case "list_project_files":
      renderFiles(event.result);
      break;
    case "read_project_file":
      codeEditor.value = event.result;
      saveBtn.disabled = false;
      break;
    case "write_project_file":
      logToTerminal(`Saved ${event.result}`);
      saveBtn.disabled = true;
      break;
    case "execute_command":
      logToTerminal(event.result, "success");
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
      <div class="project-header">
        <h3>${p.name}</h3>
        <button class="btn btn-sm delete-btn" data-name="${p.name}" title="Delete project">🗑️</button>
      </div>
      ${p.description ? `<p>${p.description}</p>` : ""}
      <div class="project-meta">
        <span>${p.created}</span>
        <span>${p.fileCount || 0} files</span>
      </div>
    </div>
  `).join("");
  
  // Add click handlers to navigate into projects
  document.querySelectorAll(".project-card").forEach(card => {
    card.addEventListener("click", (e) => {
      // Don't navigate if clicking delete button
      if (e.target.closest(".delete-btn")) return;
      const name = card.dataset.name;
      openProject(name);
    });
  });
  
  // Add delete handlers
  document.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = btn.dataset.name;
      if (confirm(`Delete project "${name}"? This cannot be undone.`)) {
        callTool("delete_project", { name });
      }
    });
  });
}

function renderFiles(result) {
  let files = Array.isArray(result) ? result : [];
  
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
  if (terminalInput.value.trim()) {
    executeCommand(terminalInput.value.trim());
  }
});

terminalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && terminalInput.value.trim()) {
    executeCommand(terminalInput.value.trim());
  }
});

function executeCommand(command) {
  logToTerminal(`$ ${command}`);
  terminalInput.value = "";
  callTool("execute_command", { command });
}

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
