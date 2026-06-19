import { Core } from "@gmloop/core";

import type { CommanderCommandLike } from "./commander-types.js";

const { isErrorLike } = Core;

const COMMANDER_ERROR_CODE_PREFIX = "commander.";
const COMMANDER_HELP_DISPLAYED_CODE = "commander.helpDisplayed";
const COMMANDER_HELP_CODE = "commander.help";

export interface CommanderErrorLike extends Error {
    code: string;
    exitCode?: number;
    command?: CommanderCommandLike;
}

export type CommanderHelpCode = typeof COMMANDER_HELP_DISPLAYED_CODE | typeof COMMANDER_HELP_CODE;

export type CommanderHelpLikeError = CommanderErrorLike & { code: CommanderHelpCode };

export type CommanderHelpError = CommanderErrorLike & { code: typeof COMMANDER_HELP_CODE };

export function isCommanderErrorLike(value: unknown): value is CommanderErrorLike {
    if (!isErrorLike(value)) {
        return false;
    }

    const candidate = value as CommanderErrorLike;
    const code = typeof candidate.code === "string" ? candidate.code : null;
    if (!code || !code.startsWith(COMMANDER_ERROR_CODE_PREFIX)) {
        return false;
    }

    if ("exitCode" in candidate && typeof candidate.exitCode !== "number") {
        return false;
    }

    return true;
}

export function isCommanderHelpDisplayedError(value: unknown): value is CommanderErrorLike {
    return isCommanderErrorLike(value) && value.code === COMMANDER_HELP_DISPLAYED_CODE;
}

/**
 * Recognize the Commander error code thrown when the parser auto-shows help
 * because a command without an action handler was invoked without selecting
 * one of its subcommands. This is distinct from `commander.helpDisplayed`
 * (which fires when the user passes `--help`) but signals the same intent:
 * help text should be visible to the user, not surfaced as a CLI failure.
 */
export function isCommanderHelpError(value: unknown): value is CommanderHelpError {
    return isCommanderErrorLike(value) && value.code === COMMANDER_HELP_CODE;
}

/**
 * Recognize every Commander error code that represents help being rendered
 * for the user rather than a true command failure.
 */
export function isCommanderHelpLikeError(value: unknown): value is CommanderHelpLikeError {
    if (!isCommanderErrorLike(value)) {
        return false;
    }

    return value.code === COMMANDER_HELP_DISPLAYED_CODE || value.code === COMMANDER_HELP_CODE;
}

export const COMMANDER_HELP_CODES = Object.freeze([COMMANDER_HELP_DISPLAYED_CODE, COMMANDER_HELP_CODE]);
