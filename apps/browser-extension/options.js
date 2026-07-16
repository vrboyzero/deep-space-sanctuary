const DEFAULT_PORT = 28892;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

const form = document.querySelector("#relayOptions");
const portInput = document.querySelector("#relayPort");
const tokenInput = document.querySelector("#relayToken");
const status = document.querySelector("#status");

async function loadOptions() {
  const stored = await chrome.storage.local.get(["relayPort", "relayToken"]);
  const port = Number.parseInt(stored.relayPort, 10);
  portInput.value = String(Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT);
  tokenInput.value = typeof stored.relayToken === "string" ? stored.relayToken : "";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const port = Number.parseInt(portInput.value, 10);
  const token = tokenInput.value.trim();
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    status.textContent = "Relay port must be between 1 and 65535.";
    return;
  }
  if (!TOKEN_PATTERN.test(token)) {
    status.textContent = "Relay credential is invalid.";
    return;
  }
  await chrome.storage.local.set({ relayPort: String(port), relayToken: token });
  status.textContent = "Saved.";
});

void loadOptions();
