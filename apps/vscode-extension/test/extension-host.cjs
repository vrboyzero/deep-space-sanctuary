const assert = require("node:assert/strict");
const vscode = require("vscode");

async function run() {
  const extension = vscode.extensions.getExtension("star-sanctuary.vscode");
  assert.ok(extension, "Star Sanctuary VS Code extension was not discovered.");
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "starSanctuary.codingRun.start",
    "starSanctuary.codingRun.stop",
    "starSanctuary.codingRun.cancelConversation",
    "starSanctuary.codingRun.cancelWorkflow",
    "starSanctuary.codingRun.subscribeConversation",
    "starSanctuary.codingRun.allowPermission",
    "starSanctuary.codingRun.denyPermission",
    "starSanctuary.codingRun.ask",
    "starSanctuary.codingRun.viewChanges",
  ]) {
    assert.ok(commands.includes(command), `Expected VS Code command ${command}.`);
  }
  await vscode.commands.executeCommand("starSanctuary.codingRun.viewChanges");
}

module.exports = { run };
