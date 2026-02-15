#!/usr/bin/env node
import path, { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import fg from 'fast-glob';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const defaultIgnore = ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/build/**', '**/.next/**', '**/.docusaurus/**'];
const depSections = ['dependencies', 'devDependencies'];
const stripPrefix = version => version.replace(/^\D+/, '');
const isStableRelease = version => /^\d+\.\d+\.\d+$/.test(version);
const extractSemVerParts = semver => semver.split('.').map(Number);
function isSemVerGreater(v1, v2) {
  const [major1, minor1, patch1] = extractSemVerParts(v1);
  const [major2, minor2, patch2] = extractSemVerParts(v2);
  if (major1 !== major2) return major1 > major2;
  if (minor1 !== minor2) return minor1 > minor2;
  return patch1 > patch2;
}
const loadConfig = async () => {
  const configPath = path.resolve('deplift.config.json');
  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
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
const parseArgs = async () => {
  let pkg = {
    version: 'unknown'
  };
  try {
    pkg = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'));
  } catch (_unused2) {}
  const argv = await yargs(hideBin(process.argv)).option('major', {
    type: 'array',
    describe: 'set major version caps: dep=version pairs',
    default: [],
    coerce: pairs => {
      const result = {};
      for (const pair of pairs) {
        const idx = pair.indexOf('=');
        if (idx === -1) {
          throw new Error(`Invalid --major value "${pair}", expected dep=version`);
        }
        const key = pair.slice(0, idx);
        const value = pair.slice(idx + 1);
        result[key] = Number(value);
      }
      return result;
    }
  }).option('dry-run', {
    type: 'boolean',
    describe: 'Run without making changes',
    default: false
  }).option('install', {
    type: 'boolean',
    describe: 'Run npm install',
    default: true
  }).version(pkg.version).strict().help().alias('dry-run', 'd').alias('version', 'v').alias('help', 'h').parse();
  return argv;
};
async function main() {
  const {
    dryRun,
    install: runInstall,
    major: majorCaps
  } = await parseArgs();
  if (dryRun) console.log('💡 Dry run enabled — no files will be changed or installed.');
  const config = await loadConfig();
  const ignorePatterns = Array.isArray(config.ignore) ? Array.from(new Set([...defaultIgnore, ...config.ignore])) : defaultIgnore;
  const packageFiles = await fg.glob('**/package.json', {
    ignore: ignorePatterns
  });
  if (packageFiles.length === 0) {
    console.log('❌ No package.json files found.');
    process.exit(0);
  }
  for (const packageJson of packageFiles) {
    const packageJsonPath = path.resolve(packageJson);
    const pkgRaw = await readFile(packageJsonPath, 'utf-8');
    let pkgData;
    try {
      pkgData = JSON.parse(pkgRaw);
    } catch (_unused3) {
      console.warn(`⚠️ Failed to parse JSON in ${packageJson}, skipping.`);
      continue;
    }
    console.log(`\n📦 Processing: ${packageJson}`);
    const dependencies = depSections.reduce((accu, section) => {
      const sectionData = pkgData[section];
      if (!sectionData) return accu;
      const entries = Object.entries(sectionData).filter(([_, version]) => !version.startsWith('file:')).map(([pkg, current]) => ({
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
      current: rawCurrent,
      latest
    } of latestDeps) {
      // Failed to fetch the pkg
      if (!latest) continue;
      const current = stripPrefix(rawCurrent);
      if (current === latest) {
        console.log(`    ${pkg} is already up to date (${latest})`);
        continue;
      }
      if (isStableRelease(current) && !isStableRelease(latest)) {
        console.log(`  ⚠️ [skipped] ${pkg}: latest version is not a stable release (${latest})`);
        continue;
      }
      if (isSemVerGreater(current, latest)) {
        console.log(`  ⚠️ [skipped] ${pkg}: current (${current}) version is higher than the latest (${latest})`);
        continue;
      }
      const [latestMajor] = extractSemVerParts(latest);
      if (latestMajor > majorCaps[pkg]) {
        console.log(`  ⚠️ [skipped] ${pkg}: ${latest} is available, but the major version is capped at v${majorCaps[pkg]}`);
        continue;
      }
      const [currentMajor] = extractSemVerParts(current);
      console.log(`  ${currentMajor === latestMajor ? '✔' : '🚨[major]'} ${pkg}(${section}): ${rawCurrent} → ^${latest}`);
      updated = true;
      if (!dryRun) {
        pkgData[section][pkg] = `^${latest}`;
      }
    }
    if (updated) {
      if (!dryRun) {
        await writeFile(packageJsonPath, JSON.stringify(pkgData, null, 2) + '\n');
        console.log(`  💾 ${packageJson} updated.`);
      }
    } else {
      console.log(`  ✅ No changes needed for ${packageJson}.`);
    }
    if (!runInstall || dryRun) continue;
    try {
      const targetDir = path.dirname(packageJsonPath);
      console.log('  📥 Installing...');
      execSync('npm install', {
        stdio: 'inherit',
        cwd: targetDir
      });
      execSync('npm audit fix', {
        stdio: 'inherit',
        cwd: targetDir
      });
    } catch (err) {
      console.error(`  ❌ Failed to install in ${packageJson}: ${err.message}`);
    }
  }
}
main().then(() => console.log('\n[deplift] ✅ All dependency updates completed!')).catch(err => {
  console.error('\n[deplift] ❌ Unexpected error:', err);
  process.exit(1);
});
