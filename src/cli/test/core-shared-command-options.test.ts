import assert from "node:assert/strict";
import { test } from "node:test";

import {
    createListOption,
    createPathOption,
    createVerboseOption,
    createWriteOption,
    LIST_OPTION_FLAGS,
    PATH_OPTION_DESCRIPTION,
    PATH_OPTION_FLAGS,
    VERBOSE_OPTION_FLAGS,
    WRITE_OPTION_DESCRIPTION,
    WRITE_OPTION_FLAGS
} from "../src/cli-core/shared-command-options.js";

void test("shared path option uses aligned name and description", () => {
    const option = createPathOption();

    assert.equal(PATH_OPTION_FLAGS, "--path <path>");
    assert.equal(option.flags, PATH_OPTION_FLAGS);
    assert.equal(option.description, PATH_OPTION_DESCRIPTION);
});

void test("shared apply-fixes option uses aligned name and default", () => {
    const option = createWriteOption();

    assert.equal(WRITE_OPTION_FLAGS, "--write");
    assert.equal(option.flags, WRITE_OPTION_FLAGS);
    assert.equal(option.description, WRITE_OPTION_DESCRIPTION);
    assert.equal(option.defaultValue, false);
});

void test("shared list option uses aligned name and default", () => {
    const option = createListOption();

    assert.equal(LIST_OPTION_FLAGS, "--list");
    assert.equal(option.flags, LIST_OPTION_FLAGS);
    assert.equal(option.defaultValue, false);
});

void test("shared verbose option uses aligned name and default", () => {
    const option = createVerboseOption();

    assert.equal(VERBOSE_OPTION_FLAGS, "--verbose");
    assert.equal(option.flags, VERBOSE_OPTION_FLAGS);
    assert.equal(option.defaultValue, false);
});
