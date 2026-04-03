const ui = {
  browserStatus: document.getElementById("browserStatus"),
  browserMeta: document.getElementById("browserMeta"),
  browserMessage: document.getElementById("browserMessage"),
  activePathPill: document.getElementById("activePathPill"),
  frame: document.getElementById("browserFrame"),
  addressForm: document.getElementById("addressForm"),
  addressInput: document.getElementById("addressInput"),
  backBtn: document.getElementById("backBtn"),
  forwardBtn: document.getElementById("forwardBtn"),
  reloadBtn: document.getElementById("reloadBtn"),
  popoutBtn: document.getElementById("popoutBtn"),
  shortcuts: Array.from(document.querySelectorAll(".browser-shortcut"))
};

const DEFAULT_PATH = "/charts";
const STORAGE_KEY = "browserPageLastPath";

let browserHistory = [];
let historyIndex = -1;

function setMessage(message, type = "") {
  ui.browserMessage.textContent = message || "";
  ui.browserMessage.className = type ? `browser-message ${type}` : "browser-message";
}

function normalizePath(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return DEFAULT_PATH;

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.origin !== window.location.origin) {
        return null;
      }
      return `${url.pathname}${url.search}${url.hash}` || DEFAULT_PATH;
    } catch {
      return null;
    }
  }

  if (!value.startsWith("/")) {
    return `/${value}`;
  }

  return value;
}

function saveLastPath(path) {
  window.localStorage.setItem(STORAGE_KEY, path);
}

function readLastPath() {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return normalizePath(stored) || DEFAULT_PATH;
}

function syncControls(path) {
  ui.addressInput.value = path;
  ui.activePathPill.textContent = path;
  ui.backBtn.disabled = historyIndex <= 0;
  ui.forwardBtn.disabled = historyIndex >= browserHistory.length - 1;
  ui.shortcuts.forEach((button) => {
    button.classList.toggle("active", button.dataset.path === path);
  });
}

function updateMeta(path) {
  ui.browserMeta.textContent = `Current view: ${path} | History entries: ${browserHistory.length}`;
}

function navigateTo(path, { push = true, reload = false } = {}) {
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) {
    setMessage("Only local app routes from this workspace can be opened in the embedded browser.", "error");
    return;
  }

  setMessage("");
  ui.browserStatus.textContent = reload ? "Reloading..." : "Loading...";
  ui.frame.src = normalizedPath;

  if (push) {
    browserHistory = browserHistory.slice(0, historyIndex + 1);
    browserHistory.push(normalizedPath);
    historyIndex = browserHistory.length - 1;
  }

  saveLastPath(normalizedPath);
  syncControls(normalizedPath);
  updateMeta(normalizedPath);
}

function handleFrameLoaded() {
  let currentPath = ui.frame.getAttribute("src") || DEFAULT_PATH;

  try {
    const frameUrl = new URL(ui.frame.contentWindow.location.href);
    if (frameUrl.origin === window.location.origin) {
      currentPath = `${frameUrl.pathname}${frameUrl.search}${frameUrl.hash}`;
    }
  } catch {
    setMessage("This view does not allow location syncing, but the page is loaded.", "warn");
  }

  if (browserHistory[historyIndex] !== currentPath) {
    browserHistory = browserHistory.slice(0, historyIndex + 1);
    browserHistory.push(currentPath);
    historyIndex = browserHistory.length - 1;
  }

  saveLastPath(currentPath);
  syncControls(currentPath);
  updateMeta(currentPath);
  ui.browserStatus.textContent = "Loaded";
}

function boot() {
  const startPath = readLastPath();
  navigateTo(startPath, { push: true });

  ui.addressForm.addEventListener("submit", (event) => {
    event.preventDefault();
    navigateTo(ui.addressInput.value, { push: true });
  });

  ui.shortcuts.forEach((button) => {
    button.addEventListener("click", () => {
      navigateTo(button.dataset.path, { push: true });
    });
  });

  ui.backBtn.addEventListener("click", () => {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    navigateTo(browserHistory[historyIndex], { push: false });
  });

  ui.forwardBtn.addEventListener("click", () => {
    if (historyIndex >= browserHistory.length - 1) return;
    historyIndex += 1;
    navigateTo(browserHistory[historyIndex], { push: false });
  });

  ui.reloadBtn.addEventListener("click", () => {
    const currentPath = browserHistory[historyIndex] || readLastPath();
    navigateTo(currentPath, { push: false, reload: true });
  });

  ui.popoutBtn.addEventListener("click", () => {
    const currentPath = browserHistory[historyIndex] || readLastPath();
    window.open(currentPath, "_blank", "noopener,noreferrer");
  });

  ui.frame.addEventListener("load", handleFrameLoaded);
}

boot();
