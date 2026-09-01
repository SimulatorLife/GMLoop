import { FixtureRunner } from "@gmloop/fixture-runner";

import { createRefactorFixtureSuiteDefinition } from "./fixture-adapter.js";

const fixtureSuite = createRefactorFixtureSuiteDefinition();

await FixtureRunner.registerNodeFixtureSuite(fixtureSuite);
