import { FixtureRunner } from "@gmloop/fixture-runner";

import { createFixtureSuiteRegistry } from "./fixture-suite-registry.js";

const fixtureSuites = createFixtureSuiteRegistry();

await fixtureSuites.reduce<Promise<void>>(async (previous, fixtureSuite) => {
    await previous;

    await FixtureRunner.registerNodeFixtureSuite({
        fixtureRoot: fixtureSuite.fixtureRoot,
        adapter: fixtureSuite.adapter
    });
}, Promise.resolve());
