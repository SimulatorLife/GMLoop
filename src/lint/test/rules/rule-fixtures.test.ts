import { FixtureRunner } from "@gmloop/fixture-runner";

import { createLintFixtureSuiteDefinition } from "./fixture-adapter.js";

const fixtureSuite = createLintFixtureSuiteDefinition();

await FixtureRunner.registerNodeFixtureSuite(fixtureSuite);
