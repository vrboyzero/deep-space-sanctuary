import { ensureFreshWorkspaceBuildsBeforeGatewayModuleLoad } from "../cli/dev-runtime-build-guard.js";
import { reportGatewayStartupPhase } from "./gateway-startup-diagnostic.js";

reportGatewayStartupPhase("entry");
ensureFreshWorkspaceBuildsBeforeGatewayModuleLoad();
reportGatewayStartupPhase("build_guard_complete");
await import("./gateway-main.js");
