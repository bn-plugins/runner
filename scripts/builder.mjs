import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";

async function exec(cmd, args, opts) {
    return await new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, {
            ...opts,
            stdio: "inherit"
        });
        proc.on("error", reject);
        proc.on("close", (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Process exited with code ${code}`));
            }
        });
    });
}

const workPath = "/work";
if (!fs.existsSync(workPath)) fs.mkdirSync(workPath);

const gitPath = path.join(workPath, "git");

const manifestPath = path.join(workPath, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

await exec("git", ["clone", manifest.repository, gitPath]);
await exec("git", ["checkout", manifest.commit], { cwd: gitPath });
execSync(manifest.command, { cwd: gitPath });

fs.cpSync(
    path.join(gitPath, manifest.distFolder ?? `dist/plugins/${manifest.id}`),
    path.join(workPath, "dist"),
    { force: true, recursive: true }
);