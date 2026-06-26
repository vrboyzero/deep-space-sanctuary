import { ensureFreshWorkspaceBuildsBeforeGatewayModuleLoad } from "../cli/dev-runtime-build-guard.js";

ensureFreshWorkspaceBuildsBeforeGatewayModuleLoad();
await import("./gateway-main.js");
