import { Core } from "@gmloop/core";

const { resolveEnvironmentMap, toTrimmedString } = Core;

export const SKIP_CLI_RUN_ENV_VAR = "PRETTIER_PLUGIN_GML_SKIP_CLI_RUN";
const SKIP_ENABLED_VALUE = "1";

export function isCliRunSkipped(env?: NodeJS.ProcessEnv | null): boolean {
    const sourceEnv = resolveEnvironmentMap(env);
    if (!sourceEnv) {
        return false;
    }

    const flagValue = toTrimmedString(sourceEnv[SKIP_CLI_RUN_ENV_VAR]);
    return flagValue === SKIP_ENABLED_VALUE;
}
