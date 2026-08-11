/**
 * @gmloop/cli — Command Misclassification Policy
 *
 * ## Separation of concerns
 *
 * `target-path-resolution.ts` owns the **mechanism** that runs when the CLI
 * `format` command receives a free-form `--path` argument: it normalizes the
 * input, calls `fs.stat`, and assembles a usage error message when the path
 * does not exist. Before this split, the same file inlined every heuristic
 * that decides whether a given token is more likely to be a CLI command name
 * than a filesystem path, plus the thresholds used to detect "did the user
 * mean to run a different command?" suggestions.
 *
 * That mixing left no seam to exercise the policy independently of the
 * filesystem or the message-rendering side effects. Adding a new command to
 * the CLI silently required the heuristics to be re-read every time the
 * threshold constants needed tuning, and the threshold formulas were not
 * unit-testable without going through the full `fs.stat` machinery.
 *
 * This module owns only the **policy**: the constants, the pure decision
 * functions, and the small set of templated strings used to suggest a
 * command in an error message. It returns a discriminated
 * `CommandMisclassificationDecision` value describing what the caller should
 * do next ("the token is unambiguously a known command", "the token is
 * probably a command — here is the closest match", or "the token is not a
 * candidate command"). The mechanism (`target-path-resolution.ts`) consumes
 * that decision to render a `CliUsageError` without re-reading the rules.
 *
 * ## Design contract
 *
 * The policy is intentionally small and pure:
 *
 * - It never touches the filesystem.
 * - It never throws or formats messages itself; it only returns decisions
 *   and reusable building blocks.
 * - It accepts a `Set<string>` of known commands so callers can override
 *   the catalog without re-architecting the evaluator (used by unit tests).
 * - Threshold constants are exported so the policy can be reasoned about
 *   in isolation while still allowing the mechanism to stay decoupled from
 *   the exact numeric values.
 */

/**
 * Maximum length difference between the candidate token and a known command
 * before the policy stops considering the token a near-match.
 *
 * Kept small so the policy does not suggest `format-something-totally-unrelated`
 * for a short command like `lint`. Raising this value broadens the search
 * window but increases the chance of false positives.
 */
export const MAX_COMMAND_LENGTH_DIFFERENCE = 2;

/**
 * Maximum number of mismatching characters between the candidate token and
 * a known command before the policy rejects the pair as a near-match.
 *
 * Combined with {@link MAX_COMMAND_LENGTH_DIFFERENCE} this is the second of
 * the two similarity gates. The pair is intentionally conservative: a user
 * typing `frmt` for `format` (1 difference, 1 length delta) is accepted,
 * but `xyzqt` (5 differences in a 5-letter command) is rejected.
 */
export const MAX_COMMAND_CHARACTER_DIFFERENCES = 2;

/**
 * Syntactic shape a candidate token must match before the policy treats it
 * as a plausible command name. Excludes path separators (handled
 * separately) and the `.ext` tail that filesystem paths carry.
 */
export const COMMAND_PATTERN = /^[a-z][a-z0-9_-]*$/i;

/**
 * Inventory passed to the evaluator so the policy never has to import the
 * CLI command catalog directly. Keeping the catalog injectable means unit
 * tests can drive the evaluator against an isolated set of names without
 * depending on the full `CLI_COMMAND_NAMES` set the CLI ships with.
 */
export interface CommandMisclassificationPolicyInput {
    /** Candidate token the user supplied in place of a filesystem path. */
    readonly target: string;
    /** Catalog of known CLI command names the policy compares against. */
    readonly knownCommands: ReadonlySet<string>;
}

/**
 * Discriminated decision the policy returns to its callers.
 *
 * The discriminator makes every branch's required data explicit so the
 * mechanism cannot accidentally read `suggestedCommand` on an
 * `"unknown"` decision or omit the help-suggestion copy when the policy
 * says to render it.
 */
export type CommandMisclassificationDecision =
    | {
          /**
           * `known-command` means the candidate token exactly matches an
           * entry in the catalog. The mechanism should treat it as a
           * deliberate command invocation and emit a help suggestion that
           * names the command back to the user.
           */
          readonly kind: "known-command";
          readonly commandName: string;
          readonly helpSuggestion: string;
      }
    | {
          /**
           * `probable-typo` means the candidate token is not a known
           * command, but it is close enough to one that the mechanism
           * should surface a "did you mean …?" suggestion. The policy
           * already picked the closest candidate; the mechanism renders it.
           */
          readonly kind: "probable-typo";
          readonly suggestedCommand: string;
          readonly helpSuggestion: string;
      }
    | {
          /**
           * `unrecognized-candidate` means the candidate token matches the
           * syntactic command shape but does not appear in the catalog and
           * has no near-match to suggest. The mechanism should render an
           * "unknown command" message with the generic help pointer.
           */
          readonly kind: "unrecognized-candidate";
          readonly helpSuggestion: string;
      }
    | {
          /**
           * `not-a-candidate` means the input is shaped like a path
           * (contains a separator, ends with a `.ext` tail, or fails the
           * syntactic command pattern). The mechanism should not treat the
           * input as a misclassified command and should fall back to the
           * generic "path not found" guidance.
           */
          readonly kind: "not-a-candidate";
      };

/**
 * The string users run to see the full CLI help from a checkout. Exposed
 * so the mechanism can reference it without re-defining the literal.
 */
export const REPOSITORY_HELP_COMMAND = "pnpm run cli -- --help";

/**
 * Build the canonical help-suggestion copy for a single command name.
 *
 * @param commandName - Command name the user appears to be invoking.
 * @returns A two-clause suggestion describing how to invoke the command's
 *          `--help` from either a checkout or a global install.
 */
export function describeHelpCommandSuggestion(commandName: string): string {
    return `Run "pnpm run cli -- ${commandName} --help" from this repository checkout (or "${commandName} --help" when the CLI is installed globally).`;
}

/**
 * Decide whether the input could plausibly be a command rather than a path.
 *
 * A token is a candidate command when it carries no path separators and no
 * `.ext` tail. The check is intentionally coarse so the upstream caller can
 * reject obvious paths without paying for the more expensive pattern and
 * similarity passes below.
 *
 * @param target - Raw candidate token.
 * @returns `true` when the input could be a command name.
 */
export function isCommandInputCandidate(target: string): boolean {
    if (target.includes("/") || target.includes("\\")) {
        return false;
    }

    return !/\.\w+$/.test(target);
}

/**
 * Compare two strings for length proximity. Pure helper used by both the
 * "has a similar known command" and "find the closest known command" passes.
 *
 * @param command - Known command name from the catalog.
 * @param target - Candidate token (already lowercased by the caller).
 * @returns `true` when the two strings are within {@link MAX_COMMAND_LENGTH_DIFFERENCE}
 *          characters of each other.
 */
export function isWithinCommandLengthThreshold(command: string, target: string): boolean {
    return Math.abs(command.length - target.length) <= MAX_COMMAND_LENGTH_DIFFERENCE;
}

/**
 * Count the number of mismatching character positions between two strings,
 * short-circuiting once {@link maxDifferences} is exceeded.
 *
 * The short-circuit keeps the cost of comparing a long candidate against
 * every catalog entry proportional to the threshold rather than the full
 * string length.
 *
 * @param command - Known command name (already lowercased).
 * @param target - Candidate token (already lowercased).
 * @param maxDifferences - Cap on the number of differences to count.
 * @returns The number of mismatching positions, capped at `maxDifferences`.
 */
export function countCommandCharacterDifferences(command: string, target: string, maxDifferences: number): number {
    let differences = 0;
    const minLength = Math.min(command.length, target.length);

    for (let index = 0; index < minLength; index += 1) {
        if (command[index] !== target[index]) {
            differences += 1;
            if (differences > maxDifferences) {
                break;
            }
        }
    }

    return differences;
}

/**
 * Apply the policy's similarity gate to a previously counted difference
 * total. Both the "is there a similar command?" and "which command is
 * closest?" passes share this gate so the rules cannot drift.
 *
 * @param differences - Mismatch count returned by
 *     {@link countCommandCharacterDifferences}.
 * @param commandLength - Length of the known command being compared.
 * @returns `true` when the difference count is within both the absolute cap
 *          and the relative half-length cap.
 */
export function isWithinCommandSimilarityThreshold(differences: number, commandLength: number): boolean {
    return differences <= MAX_COMMAND_CHARACTER_DIFFERENCES && differences < commandLength / 2;
}

/**
 * Identify likely command typos by comparing the candidate token against
 * every entry in {@link CommandMisclassificationPolicyInput.knownCommands}.
 *
 * @param target - Candidate token from the user.
 * @param knownCommands - Catalog of valid command names.
 * @returns `true` when at least one catalog entry falls inside both the
 *          length and the character-difference windows.
 */
export function hasSimilarKnownCommand(target: string, knownCommands: ReadonlySet<string>): boolean {
    const lowerTarget = target.toLowerCase();

    for (const command of knownCommands) {
        if (!isWithinCommandLengthThreshold(command, lowerTarget)) {
            continue;
        }

        const differences = countCommandCharacterDifferences(command, lowerTarget, MAX_COMMAND_CHARACTER_DIFFERENCES);

        if (isWithinCommandSimilarityThreshold(differences, command.length)) {
            return true;
        }
    }

    return false;
}

/**
 * Pick the closest catalog entry to {@link target}, weighted by the sum of
 * mismatching characters and length delta. Returns `null` when no entry is
 * close enough to suggest.
 *
 * @param target - Candidate token from the user.
 * @param knownCommands - Catalog of valid command names.
 * @returns The closest matching command name, or `null` when no entry
 *          satisfies the similarity gate.
 */
export function resolveClosestKnownCommand(target: string, knownCommands: ReadonlySet<string>): string | null {
    const normalizedTarget = target.toLowerCase();
    let closestCommand: string | null = null;
    let closestScore = Number.POSITIVE_INFINITY;

    for (const command of knownCommands) {
        if (!isWithinCommandLengthThreshold(command, normalizedTarget)) {
            continue;
        }

        const differences = countCommandCharacterDifferences(command, normalizedTarget, Number.POSITIVE_INFINITY);

        if (!isWithinCommandSimilarityThreshold(differences, command.length)) {
            continue;
        }

        const score = differences + Math.abs(command.length - normalizedTarget.length);

        if (score < closestScore) {
            closestScore = score;
            closestCommand = command;
        }
    }

    return closestCommand;
}

/**
 * Evaluate the command-misclassification policy for a candidate target.
 *
 * The evaluator encapsulates the previously inlined decision flow used by
 * the `format` command's error rendering:
 *
 *   1. Inputs shaped like paths exit early with `"not-a-candidate"`.
 *   2. Exact matches against the catalog emit `"known-command"`.
 *   3. Tokens matching the command pattern but absent from the catalog are
 *      checked for typos; the closest entry, if any, becomes
 *      `"probable-typo"`.
 *   4. Pattern-matching tokens with no near-match fall through to
 *      `"unrecognized-candidate"`.
 *   5. Tokens that fail the syntactic command pattern fall through to
 *      `"not-a-candidate"` so the mechanism uses the generic guidance.
 *
 * Every branch that produces user-facing copy returns the help-suggestion
 * text it should be rendered with so the mechanism does not have to
 * recompute it.
 *
 * @param input - Candidate token and the catalog to evaluate against.
 * @returns A discriminated decision describing how the mechanism should
 *          react to the input.
 */
export function evaluateCommandMisclassification(
    input: CommandMisclassificationPolicyInput
): CommandMisclassificationDecision {
    const { target, knownCommands } = input;

    if (!isCommandInputCandidate(target)) {
        return { kind: "not-a-candidate" };
    }

    if (knownCommands.has(target)) {
        return {
            kind: "known-command",
            commandName: target,
            helpSuggestion: describeHelpCommandSuggestion(target)
        };
    }

    if (!COMMAND_PATTERN.test(target)) {
        return { kind: "not-a-candidate" };
    }

    const closestMatch = resolveClosestKnownCommand(target, knownCommands);
    if (closestMatch !== null) {
        return {
            kind: "probable-typo",
            suggestedCommand: closestMatch,
            helpSuggestion: describeHelpCommandSuggestion(closestMatch)
        };
    }

    return {
        kind: "unrecognized-candidate",
        helpSuggestion: `Run "${REPOSITORY_HELP_COMMAND}" to see available commands in this checkout (or "gmloop --help" if installed globally).`
    };
}
