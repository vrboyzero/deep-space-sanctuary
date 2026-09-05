type GatewayStartupPhase = "entry" | "build_guard_complete" | "module_body" | "server_listening";
type GatewayStartupProcess = Pick<NodeJS.Process, "env" | "connected" | "send">;

export function reportGatewayStartupPhase(
  phase: GatewayStartupPhase,
  runtime: GatewayStartupProcess = process,
): void {
  if (runtime.env.BELLDANDY_GATEWAY_STARTUP_DIAGNOSTIC !== "ipc-v1"
    || !runtime.connected
    || typeof runtime.send !== "function") return;
  try {
    // Diagnostic transport must not change Gateway startup or shutdown behavior.
    runtime.send({ type: "gateway.startup/v1", phase }, () => {});
  } catch {
    // The parent may have closed IPC while cancelling a slow startup.
  }
}
