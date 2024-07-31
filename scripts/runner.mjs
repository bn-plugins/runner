import fs from "fs/promises";
import fssync from "fs";
import { spawn } from "child_process";
import path from "path";

function checkEnv(name) {
    if (process.env[name] == null) {
        console.error(`Missing environment variable ${name}`);
        process.exit(1);
    }

    return process.env[name];
}

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

const manifestsPath = checkEnv("MANIFESTS_PATH");
const distPath = checkEnv("DIST_PATH");
const workPath = checkEnv("WORK_PATH");
const changesPath = process.env["CHANGES_PATH"];

const pluginManifests = (await fs.readdir(manifestsPath, { withFileTypes: true }))
    .filter(d => d.isFile() && d.name.endsWith(".json"))
    .map(d => d.name.replace(/\.json$/, ""));

if (fssync.existsSync(workPath)) {
    await fs.rm(workPath, { recursive: true });
}
await fs.mkdir(workPath);

if (changesPath) {
    if (fssync.existsSync(changesPath)) {
        await fs.rm(changesPath, { recursive: true });
    }
    await fs.mkdir(changesPath);
}
 

var currentState = {};

for (const name of pluginManifests) {
    const manifestPath = path.join(manifestsPath, `${name}.json`);
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    currentState[name] = manifest;
}

const statePath = path.join(distPath, "state.json")
const prevState = fssync.existsSync(statePath) ? JSON.parse(await fs.readFile(statePath, "utf8")) : {};
await fs.writeFile(statePath, JSON.stringify(currentState));

const changed = [];
const deleted = [];

for (const name in currentState) {
    if (prevState[name] == null || prevState[name].commit !== currentState[name].commit) {
        changed.push(name);
    }
}

for (const name in prevState) {
    if (currentState[name] == null) {
        deleted.push(name);
    }
}

if (changed.length === 0 && deleted.length === 0) {
    console.log("No changes detected");
    process.exit(0);
}


if (changed.length > 0) {
    console.log("Changed plugins:");
    for (const name of changed) {
        console.log(`\t- ${name}`);
    }
}

if (deleted.length > 0) {
    console.log("Deleted plugins:");
    for (const name of deleted) {
        console.log(`\t- ${name}`);
    }
}

async function run(id, manifest) {
    const plugWorkPath = path.join(workPath, id);
    const plugDistPath = path.join(plugWorkPath, "dist");
    await fs.mkdir(plugDistPath, { recursive: true });

    const plugManifestPath = path.join(plugWorkPath, "manifest.json");
    await fs.writeFile(plugManifestPath, JSON.stringify(manifest));

    await exec("docker", [
        "run",
        "--rm",
        "-v",
        `${plugDistPath}:/work/dist`,
        "-v",
        `${plugManifestPath}:/work/manifest.json`,
        "bn-plugins/plugin-builder:latest",
    ]);

    if (!(await fs.readdir(plugDistPath)).length === 0) {
        console.error(`Plugin dist ${plugDistPath} is empty`);
        process.exit(1);
    }

    const targetDir = path.join(distPath, "plugins", id);
    if (fssync.existsSync(targetDir)) {
        await fs.rm(targetDir, { recursive: true });
    }

    await fs.mkdir(targetDir, { recursive: true });
    await fs.cp(plugDistPath, targetDir, { recursive: true });
    if (changesPath) {
        await fs.cp(plugDistPath, path.join(changesPath, id), { recursive: true });
    }
}

// Build changed plugins
for (const id of changed) {
    await run(id, currentState[id]);
}

for (const name of changed) {
    const oldCommit = prevState[name]?.commit ?? "<none>";
    const newCommit = currentState[name].commit;
    let msg = `${name}: ${oldCommit} -> ${newCommit}`;

    if (currentState[name].repository.startsWith("https://github.com/")) {
        const repoUrl = currentState[name].repository.replace(".git", "");

        let diffUrl =
            oldCommit === "<none>"
                ? `${repoUrl}/tree/${newCommit}`
                : `${repoUrl}/compare/${oldCommit}...${newCommit}`;
        msg += ` (${diffUrl})`;
    }

    console.log(msg);
}

// Yeet deleted plugins
for (const id of deleted) {
    const pluginDir = path.join(distPath, "plugins", id);
    if (fssync.existsSync(pluginDir)) {
        await fs.rm(pluginDir, { recursive: true });
    }

    const oldCommit = prevState[id]?.commit ?? "<none>";
    console.log(`${id}: ${oldCommit} -> <none>`);
}

// Remove the previous repo.json, if any
const pluginsDistPath = path.join(distPath, "plugins");
const repoJsonPath = path.join(distPath, "repo.json");

if (fssync.existsSync(repoJsonPath)) {
    await fs.unlink(repoJsonPath);
}

// Write our repository informations
const repo = {};

for (const id of await fs.readdir(pluginsDistPath)) {
    const pluginDist = path.join(pluginsDistPath, id);
    if (!(await fs.lstat(pluginDist)).isDirectory()) continue;

    const manifest = JSON.parse(
        await fs.readFile(path.join(pluginDist, "manifest.json"))
    );

    repo[id] = {
        version: manifest.version
    };
};

await fs.writeFile(repoJsonPath, JSON.stringify(repo));
