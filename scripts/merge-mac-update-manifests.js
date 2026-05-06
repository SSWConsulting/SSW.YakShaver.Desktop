#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const ARCHES = ["arm64", "x64"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseArgs(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    options[key] = value;
    index += 1;
  }

  return options;
}

function loadManifest(manifestPath) {
  const manifest = yaml.load(fs.readFileSync(manifestPath, "utf8"));
  if (!isRecord(manifest)) {
    throw new Error(`Manifest is not a YAML object: ${manifestPath}`);
  }

  return manifest;
}

function toFileEntries(manifest) {
  if (Array.isArray(manifest.files)) {
    return manifest.files;
  }

  if (typeof manifest.path === "string" && typeof manifest.sha512 === "string") {
    return [
      {
        url: manifest.path,
        sha512: manifest.sha512,
      },
    ];
  }

  throw new Error("Manifest must include a files array or legacy path/sha512 fields");
}

function normalizeUrlPath(url) {
  return url.replace(/\\/g, "/");
}

function isMacZipForArch(file, arch) {
  if (!isRecord(file) || typeof file.url !== "string") {
    return false;
  }

  return normalizeUrlPath(file.url).endsWith(`-${arch}-mac.zip`);
}

function findMacZipEntry(manifest, arch, manifestPath) {
  const entries = toFileEntries(manifest).filter((file) => isMacZipForArch(file, arch));

  if (entries.length !== 1) {
    throw new Error(
      `${manifestPath} must contain exactly one ${arch} mac ZIP entry; found ${entries.length}`,
    );
  }

  const entry = entries[0];
  if (!isRecord(entry) || typeof entry.url !== "string" || typeof entry.sha512 !== "string") {
    throw new Error(`${manifestPath} ${arch} entry must include url and sha512`);
  }

  return { ...entry };
}

function assertSingleArchManifest(manifest, expectedArch, manifestPath) {
  findMacZipEntry(manifest, expectedArch, manifestPath);

  for (const arch of ARCHES) {
    if (arch === expectedArch) {
      continue;
    }

    const unexpectedEntries = toFileEntries(manifest).filter((file) => isMacZipForArch(file, arch));
    if (unexpectedEntries.length > 0) {
      throw new Error(`${manifestPath} is expected to be ${expectedArch}, but contains ${arch}`);
    }
  }
}

function validateMergedManifest(manifest, manifestPath) {
  const entriesByArch = new Map(
    ARCHES.map((arch) => [arch, findMacZipEntry(manifest, arch, manifestPath)]),
  );

  const fileEntries = toFileEntries(manifest);
  const windowsEntries = fileEntries.filter(
    (file) => isRecord(file) && typeof file.url === "string" && file.url.endsWith(".exe"),
  );

  if (windowsEntries.length > 0) {
    throw new Error(`${manifestPath} must not include Windows installer entries`);
  }

  return entriesByArch;
}

function mergeMacUpdateManifests({ arm64Manifest, x64Manifest, output }) {
  assertSingleArchManifest(arm64Manifest, "arm64", "arm64 manifest");
  assertSingleArchManifest(x64Manifest, "x64", "x64 manifest");

  if (arm64Manifest.version !== x64Manifest.version) {
    throw new Error(
      `Mac manifests must have the same version: ${arm64Manifest.version} != ${x64Manifest.version}`,
    );
  }

  const arm64Entry = findMacZipEntry(arm64Manifest, "arm64", "arm64 manifest");
  const x64Entry = findMacZipEntry(x64Manifest, "x64", "x64 manifest");
  const merged = {
    ...arm64Manifest,
    files: [arm64Entry, x64Entry],
    path: arm64Entry.url,
    sha512: arm64Entry.sha512,
  };

  if (arm64Entry.sha2) {
    merged.sha2 = arm64Entry.sha2;
  } else {
    delete merged.sha2;
  }

  validateMergedManifest(merged, output);

  return merged;
}

function writeManifest(manifestPath, manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, yaml.dump(manifest, { lineWidth: 120, noRefs: true }), "utf8");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const requiredOptions = ["arm64", "x64", "output"];
  for (const option of requiredOptions) {
    if (!options[option]) {
      throw new Error(`Missing required --${option} option`);
    }
  }

  const merged = mergeMacUpdateManifests({
    arm64Manifest: loadManifest(options.arm64),
    x64Manifest: loadManifest(options.x64),
    output: options.output,
  });

  writeManifest(options.output, merged);
  console.log(`Merged macOS update manifest written to ${options.output}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

module.exports = {
  mergeMacUpdateManifests,
  validateMergedManifest,
};
