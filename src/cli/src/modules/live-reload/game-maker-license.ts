import { readFile } from "node:fs/promises";

import { XMLParser } from "fast-xml-parser";

type GameMakerLicenseXmlValue =
    string | number | boolean | null | GameMakerLicenseXmlObject | ReadonlyArray<GameMakerLicenseXmlValue>;

type GameMakerLicenseXmlObject = {
    readonly [key: string]: GameMakerLicenseXmlValue;
};

const gameMakerLicenseXmlParser = new XMLParser({
    ignoreAttributes: true,
    isArray: (tagName) => tagName === "string",
    trimValues: true
});

/**
 * Check whether a GameMaker licence file advertises the HTML5 build module.
 *
 * GameMaker stores both current XML licences (`Features`) and older XML
 * licences (`components`) in the same `.plist` format. The parser walks all
 * text nodes so the entitlement check works for both representations without
 * depending on the surrounding licence schema.
 *
 * @param licenseFile - Path to the GameMaker `licence.plist` file.
 * @returns `true` when the licence contains the HTML5 build entitlement.
 */
export async function hasGameMakerHtml5BuildEntitlement(licenseFile: string): Promise<boolean> {
    try {
        const licenseXml = await readFile(licenseFile, "utf8");
        const parsedLicense = gameMakerLicenseXmlParser.parse(licenseXml) as GameMakerLicenseXmlObject;
        const textValues: Array<string> = [];
        collectGameMakerLicenseTextValues(parsedLicense, textValues);

        return textValues.some((textValue) => textValue.split(/[;,\s]+/u).includes("HTML5.build_module"));
    } catch {
        return false;
    }
}

function collectGameMakerLicenseTextValues(value: GameMakerLicenseXmlValue, target: Array<string>): void {
    if (typeof value === "string") {
        target.push(value);
        return;
    }

    if (Array.isArray(value)) {
        for (const entry of value) {
            collectGameMakerLicenseTextValues(entry, target);
        }
        return;
    }

    if (value === null || typeof value !== "object") {
        return;
    }

    for (const entry of Object.values(value)) {
        collectGameMakerLicenseTextValues(entry, target);
    }
}
