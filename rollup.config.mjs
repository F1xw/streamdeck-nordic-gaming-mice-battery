import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import path from "node:path";
import url from "node:url";
import fs from "node:fs";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "tech.flowei.gaming-mouse-battery.sdPlugin";

/**
 * @type {import('rollup').RollupOptions}
 */
const config = {
    input: "src/plugin.ts",
    output: {
        file: `${sdPlugin}/bin/plugin.js`,
        sourcemap: isWatching,
        sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
            return url.pathToFileURL(
                path.resolve(path.dirname(sourcemapPath), relativeSourcePath)
            ).href;
        },
    },
    plugins: [
        {
            name: "watch-externals",
            buildStart: function () {
                this.addWatchFile(`${sdPlugin}/manifest.json`);
            },
        },
        typescript({
            mapRoot: isWatching ? "./" : undefined,
        }),
        json({ preferConst: true }),
        nodeResolve({
            browser: false,
            exportConditions: ["node"],
            preferBuiltins: true,
        }),
        commonjs(),
        !isWatching && terser(),
        {
            name: "emit-module-package-file",
            generateBundle() {
                this.emitFile({
                    fileName: "package.json",
                    source: `{ "type": "module" }`,
                    type: "asset",
                });
            },
        },
        {
            name: "copy-node-hid",
            generateBundle() {
                // Ensure native dependency is shipped with the plugin
                const srcDir = path.resolve("node_modules", "node-hid");
                const destDir = path.resolve(
                    sdPlugin,
                    "node_modules",
                    "node-hid"
                );
                if (!fs.existsSync(srcDir)) {
                    this.warn(
                        "node-hid not installed; battery action will not work."
                    );
                    return;
                }
                if (fs.existsSync(destDir)) {
                    return;
                }
                copyDirRecursive(srcDir, destDir);
            },
        },
    ],
};

export default config;

function copyDirRecursive(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else if (entry.isSymbolicLink()) {
            const target = fs.readlinkSync(srcPath);
            try {
                fs.symlinkSync(target, destPath);
            } catch {
                /* ignore on Windows */
            }
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
