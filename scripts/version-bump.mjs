import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

// Read and update manifest.json
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

console.log(`Updated manifest.json to version ${targetVersion}`);
