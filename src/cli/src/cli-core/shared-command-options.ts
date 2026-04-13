import { Option } from "commander";

export const PATH_OPTION_FLAGS = "--path <path>";
export const PATH_OPTION_DESCRIPTION = "Target .gml file, GameMaker project directory, or .yyp path";

export const WRITE_OPTION_FLAGS = "--write";
export const WRITE_OPTION_DESCRIPTION = "Apply changes to files";
export const CONFIG_OPTION_FLAGS = "--config <path>";
export const CONFIG_OPTION_DESCRIPTION =
    "Path to a custom gmloop.json config file (defaults to gmloop.json in the project root)";
export const LIST_OPTION_FLAGS = "--list";
export const LIST_OPTION_DESCRIPTION = "List effective command settings and exit";
export const VERBOSE_OPTION_FLAGS = "--verbose";
export const VERBOSE_OPTION_DESCRIPTION = "Enable verbose output with detailed diagnostics";

function createDisabledByDefaultBooleanOption(flags: string, description: string): Option {
    const option = new Option(flags, description);
    option.default(false);
    return option;
}

export function createPathOption(): Option {
    return new Option(PATH_OPTION_FLAGS, PATH_OPTION_DESCRIPTION);
}

export function createWriteOption(): Option {
    return createDisabledByDefaultBooleanOption(WRITE_OPTION_FLAGS, WRITE_OPTION_DESCRIPTION);
}

export function createConfigOption(): Option {
    return new Option(CONFIG_OPTION_FLAGS, CONFIG_OPTION_DESCRIPTION);
}

export function createListOption(): Option {
    return createDisabledByDefaultBooleanOption(LIST_OPTION_FLAGS, LIST_OPTION_DESCRIPTION);
}

export function createVerboseOption(): Option {
    return createDisabledByDefaultBooleanOption(VERBOSE_OPTION_FLAGS, VERBOSE_OPTION_DESCRIPTION);
}
