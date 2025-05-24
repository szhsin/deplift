#!/usr/bin/env node
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import fg from 'fast-glob';

const defaultIgnore = ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/build/**", "**/.next/**", "**/.docusaurus/**"];
const depSections = ["dependencies", "devDependencies"];
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
if (dryRun) console.log("💡 Dry run enabled — no files will be changed or installed.");
const stripPrefix = version => version.replace(/^[^0-9]*/, "");
const loadConfig = async () => {
  const configPath = path.resolve("deplift.config.json");
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    console.warn(`⚠️ Config file exists but is not a valid object: ${configPath}`);
  } catch (_unused) {
    // no config file or cannot read, ignore silently
  }
  return {};
};
const fetchLatestVersion = async dep => {
  const {
    pkg
  } = dep;
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`);
    if (!res.ok) {
      throw new Error(`status: ${res.status}`);
    }
    const json = await res.json();
    return {
      ...dep,
      latest: json.version
    };
  } catch (err) {
    console.warn(`  ⚠️ Failed to fetch version for ${pkg}: ${err.message}`);
  }
  return dep;
};
async function main() {
  const config = await loadConfig();
  const ignorePatterns = Array.isArray(config.ignore) ? Array.from(new Set([...defaultIgnore, ...config.ignore])) : defaultIgnore;
  const packageFiles = await fg.glob("**/package.json", {
    ignore: ignorePatterns
  });
  if (packageFiles.length === 0) {
    console.log("❌ No package.json files found.");
    process.exit(0);
  }
  for (const packageJson of packageFiles) {
    const packageJsonPath = path.resolve(packageJson);
    const pkgRaw = await readFile(packageJsonPath, "utf-8");
    let pkgData;
    try {
      pkgData = JSON.parse(pkgRaw);
    } catch (_unused2) {
      console.warn(`⚠️ Failed to parse JSON in ${packageJson}, skipping.`);
      continue;
    }
    console.log(`\n📦 Processing: ${packageJson}`);
    const dependencies = depSections.reduce((accu, section) => {
      const sectionData = pkgData[section];
      if (!sectionData) return accu;
      const entries = Object.entries(sectionData).filter(([_, version]) => !version.startsWith("file:")).map(([pkg, current]) => ({
        section,
        pkg,
        current
      }));
      return [...accu, ...entries];
    }, []);
    const latestDeps = await Promise.all(dependencies.map(fetchLatestVersion));
    let updated = false;
    for (const {
      section,
      pkg,
      current,
      latest
    } of latestDeps) {
      // Failed to fetch the pkg
      if (!latest) continue;
      if (stripPrefix(current) === latest) {
        console.log(`    ${pkg} is already at latest version (${latest})`);
        continue;
      }
      console.log(`  ✔ ${section} -> ${pkg}: ${current} → ^${latest}`);
      updated = true;
      if (!dryRun) {
        pkgData[section][pkg] = `^${latest}`;
      }
    }
    if (!updated) {
      console.log(`  ✅ No changes needed for ${packageJson}.`);
      continue;
    }
    if (dryRun) {
      console.log(`  📥 [Dry run] "npm install" for ${packageJson}.`);
      continue;
    }
    await writeFile(packageJsonPath, JSON.stringify(pkgData, null, 2) + "\n");
    console.log(`  💾 ${packageJson} updated.`);
    try {
      const targetDir = path.dirname(packageJsonPath);
      console.log("  📥 Installing...");
      execSync("npm install", {
        stdio: "inherit",
        cwd: targetDir
      });
    } catch (err) {
      console.error(`  ❌ Failed to install in ${packageJson}: ${err.message}`);
    }
  }
}
main().then(() => console.log("\n[deplift] ✅ All dependency updates completed!")).catch(err => {
  console.error("\n[deplift] ❌ Unexpected error:", err);
  process.exit(1);
});
