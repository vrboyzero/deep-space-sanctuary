import type { CLIContext } from "../../shared/context.js";
import type { AdvancedModule } from "../../wizard/advanced-modules-shared.js";
import type { AdvancedModulesWizardResult } from "../../wizard/advanced-modules.js";

export interface ConfigureCompletionSummary {
  changed: boolean;
  message: string;
  notes: string[];
}

const STARWEAVER_SHARED_HOST_NOTE = "Starweaver shared-host default remains: prefer starweaver-central, keep local starweaver only as fallback with autoConnect=false.";

export function describeConfigureCompletion(
  module: AdvancedModule,
  label: string,
  result: AdvancedModulesWizardResult,
): ConfigureCompletionSummary {
  const changed = result.configuredModules.includes(module);
  return {
    changed,
    message: changed ? `${label} configuration saved` : `${label} configuration unchanged`,
    notes: [...result.notes, STARWEAVER_SHARED_HOST_NOTE],
  };
}

export function printConfigureCompletion(
  ctx: CLIContext,
  module: AdvancedModule,
  label: string,
  result: AdvancedModulesWizardResult,
): void {
  const summary = describeConfigureCompletion(module, label, result);

  if (ctx.json) {
    ctx.output({
      module,
      label,
      changed: summary.changed,
      configuredModules: result.configuredModules,
      notes: summary.notes,
    });
    return;
  }

  if (summary.changed) {
    ctx.success(summary.message);
  } else {
    ctx.log(summary.message);
  }
  for (const note of summary.notes) {
    ctx.log(`  ${note}`);
  }
}
