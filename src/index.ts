// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from "fs-extra";
import * as path from "path";
import * as prettier from "prettier";
import * as ts from "typescript";

import * as prettierSettings from "./prettier.json";

const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2018,
    module: ts.ModuleKind.ES2015,
}

const prettierOptions : prettier.Options = {
    ...prettierSettings as prettier.Options,
    parser: "babel"
}

/**
 * A set of replacements to perform. Structured as an array of doubles:
 * 
 * [<matching regex>, <replacement string>]
 * 
 * Given as arguments to string.replace. Called in this order.
 */
const REGEX_STACK: Array<[RegExp, string]> = [
    [/import\s+\*\s+as\s+dotenv\s+from\s*"dotenv"\s*;\s*\n\s*dotenv.config\({[^{]*}\)\s*;\s*/, "require(\"dotenv\").config();\n\n"], // Needs some special handling
    [/import\s+({[^}]+})\s+from\s*("[^"]+");/sg, "const $1 = require($2);"],
    [/import\s+([^\s]+)\s+from\s*("[^"]+");/g, "const $1 = require($2);"],
    [/import\s+\*\s+as\s+([^\s]+)\s+from\s*("[^"]+");/g, "const $1 = require($2);"],
    [/export async function main/, "async function main"]
];

/**
 * Restores missing line-spacing that is removed by the typescript compiler.
 * 
 * It's not perfect, but it seems to do a pretty good job.
 */
function lineNormalize(a : string[], b : string[]) : string {
    const final = [];
    let cursorA = 0;

    console.log(a);
    console.log(b);

    for (let i = 0; i < b.length; i++) {
        const line = b[i].trim();
        const candidate = a[cursorA].trim();

        console.log("Compare: {{", line, "}} with {{", candidate, "}}")

        if (line === "" && candidate === "") { // Rare
            cursorA += 1;
            final.push("");
        } else if (line !== "" && candidate !== "") { // Good match
            if (line.startsWith("import")) {
                console.log("Import encountered.")

                // Imports require special consideration because typescript can erase them if they are type-only
                // When we reach a line that contains a semicolon, we are done with the import
                while (!a[cursorA].includes(";")) {
                    console.log("[import] consuming", a[cursorA])
                    final.push(a[cursorA])
                    cursorA += 1;
                }
                console.log("[import] consuming", a[cursorA])
                final.push(a[cursorA]);
                cursorA += 1;

                while (!b[i].includes(";")) {
                    i += 1;
                }
            } else {
                cursorA += 1;
                final.push(candidate);
            }
        } else if (line === "" && candidate !== "") { // A blank line was eliminated
            final.push("");
        } else { // Should really never happen
            throw new Error("lineNormalization encountered strange blank line in output")
        }
        
    }

    return final.join("\n");
}

/**
 * Handles the formatting of the resulting JS text.
*/
async function postTransform(outText: string, inText: string): Promise<string> {
    let text = lineNormalize(outText.split("\n"), inText.split("\n"));

    text = prettier.format(text, prettierOptions);

    for (const [match, replacement] of REGEX_STACK) {
        text = text.replace(match, replacement);
    }

    return prettier.format(text, prettierOptions);
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length !== 2) {
        throw new Error("Wrong number of arguments. Got " + args.length + " but expected 2.")
    }

    const [src, dest] = args.map(path.normalize);
    
    const srcText = (await fs.promises.readFile(src)).toString("utf-8");

    const output = ts.transpileModule(srcText, {
        compilerOptions,
        fileName: src
    });

    // Set printWidth to 1 to make prettier insert as many newlines as possible. This will help
    // during normalization to make sure that as many lines match exactly as possible, which gives
    // us a lot of flexibility to analyze lines for hints about how they should be separated
    const formattedOutput = prettier.format(output.outputText, { ... prettierOptions, printWidth: 1 });
    const formattedInput = prettier.format(srcText, { ...prettierOptions, parser: "typescript", printWidth: 1 });

    await fs.ensureDir(path.dirname(dest));
    await fs.promises.writeFile(dest, await postTransform(formattedOutput, formattedInput));
}

main().catch((error) => {
    console.error("[ts-to-js]", error);
    process.exit(1);
});