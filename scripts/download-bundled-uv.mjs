#!/usr/bin/env zx

import 'zx/globals';
import { resolveUvDownloadUrls } from './lib/uv-download.mjs';

const ROOT_DIR = path.resolve(__dirname, '..');
const UV_VERSION = '0.10.0';
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;

// Mapping Node platforms/archs to uv release naming
const TARGETS = {
  'darwin-arm64': {
    filename: 'uv-aarch64-apple-darwin.tar.gz',
    binName: 'uv',
  },
  'darwin-x64': {
    filename: 'uv-x86_64-apple-darwin.tar.gz',
    binName: 'uv',
  },
  'win32-arm64': {
    filename: 'uv-aarch64-pc-windows-msvc.zip',
    binName: 'uv.exe',
  },
  'win32-x64': {
    filename: 'uv-x86_64-pc-windows-msvc.zip',
    binName: 'uv.exe',
  },
  'linux-arm64': {
    filename: 'uv-aarch64-unknown-linux-gnu.tar.gz',
    binName: 'uv',
  },
  'linux-x64': {
    filename: 'uv-x86_64-unknown-linux-gnu.tar.gz',
    binName: 'uv',
  }
};

// Platform groups for building multi-arch packages
const PLATFORM_GROUPS = {
  'mac': ['darwin-x64', 'darwin-arm64'],
  'win': ['win32-x64', 'win32-arm64'],
  'linux': ['linux-x64', 'linux-arm64']
};

async function downloadArchive(downloadUrls, archivePath, timeoutMs) {
  const failures = [];

  for (const downloadUrl of downloadUrls) {
    try {
      echo`⬇️ Downloading: ${downloadUrl}`;
      const response = await fetch(downloadUrl, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      await fs.writeFile(archivePath, Buffer.from(buffer));
      return downloadUrl;
    } catch (error) {
      failures.push(`${downloadUrl} -> ${error instanceof Error ? error.message : String(error)}`);
      echo(chalk.yellow(`⚠️ Download failed: ${downloadUrl}`));
    }
  }

  throw new Error(`Failed to download uv archive from all candidate sources:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
}

async function setupTarget(id) {
  const target = TARGETS[id];
  if (!target) {
    echo(chalk.yellow`⚠️ Target ${id} is not supported by this script.`);
    return;
  }

  const targetDir = path.join(OUTPUT_BASE, id);
  const tempDir = path.join(ROOT_DIR, 'temp_uv_extract', id);
  const stagingDir = path.join(ROOT_DIR, 'temp_uv_stage', id);
  const archivePath = path.join(ROOT_DIR, target.filename);
  const stagedBin = path.join(stagingDir, target.binName);
  const destBin = path.join(targetDir, target.binName);
  const downloadUrls = resolveUvDownloadUrls(target.filename, UV_VERSION);
  const downloadTimeoutMs = Number.parseInt(process.env.CLAWX_UV_DOWNLOAD_TIMEOUT_MS || '', 10) || DEFAULT_DOWNLOAD_TIMEOUT_MS;

  echo(chalk.blue`\n📦 Setting up uv for ${id}...`);

  // Cleanup & Prep
  await fs.remove(tempDir);
  await fs.remove(stagingDir);
  await fs.ensureDir(targetDir);
  await fs.ensureDir(tempDir);
  await fs.ensureDir(stagingDir);

  try {
    // Download
    await downloadArchive(downloadUrls, archivePath, downloadTimeoutMs);

    // Extract
    echo`📂 Extracting...`;
    if (target.filename.endsWith('.zip')) {
      if (os.platform() === 'win32') {
        const { execFileSync } = await import('child_process');
        const psCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${archivePath.replace(/'/g, "''")}', '${tempDir.replace(/'/g, "''")}')`;
        execFileSync('powershell.exe', ['-NoProfile', '-Command', psCommand], { stdio: 'inherit' });
      } else {
        await $`unzip -q -o ${archivePath} -d ${tempDir}`;
      }
    } else {
      await $`tar -xzf ${archivePath} -C ${tempDir}`;
    }

    // Move binary
    // uv archives usually contain a folder named after the target
    const folderName = target.filename.replace('.tar.gz', '').replace('.zip', '');
    const sourceBin = path.join(tempDir, folderName, target.binName);

    if (await fs.pathExists(sourceBin)) {
      await fs.move(sourceBin, stagedBin, { overwrite: true });
    } else {
      echo(chalk.yellow`🔍 Binary not found in expected subfolder, searching...`);
      const files = await glob(`**/${target.binName}`, { cwd: tempDir, absolute: true });
      if (files.length > 0) {
        await fs.move(files[0], stagedBin, { overwrite: true });
      } else {
        throw new Error(`Could not find ${target.binName} in extracted files.`);
      }
    }

    // Permission fix
    if (os.platform() !== 'win32') {
      await fs.chmod(stagedBin, 0o755);
    }

    await fs.move(stagedBin, destBin, { overwrite: true });
    echo(chalk.green`✅ Success: ${destBin}`);
  } finally {
    // Cleanup
    await fs.remove(archivePath);
    await fs.remove(tempDir);
    await fs.remove(stagingDir);
  }
}

// Main logic
const downloadAll = argv.all;
const platform = argv.platform;

if (downloadAll) {
  // Download for all platforms
  echo(chalk.cyan`🌐 Downloading uv binaries for ALL supported platforms...`);
  for (const id of Object.keys(TARGETS)) {
    await setupTarget(id);
  }
} else if (platform) {
  // Download for a specific platform (e.g., --platform=mac)
  const targets = PLATFORM_GROUPS[platform];
  if (!targets) {
    echo(chalk.red`❌ Unknown platform: ${platform}`);
    echo(`Available platforms: ${Object.keys(PLATFORM_GROUPS).join(', ')}`);
    process.exit(1);
  }
  
  echo(chalk.cyan`🎯 Downloading uv binaries for platform: ${platform}`);
  echo(`   Architectures: ${targets.join(', ')}`);
  for (const id of targets) {
    await setupTarget(id);
  }
} else {
  // Download for current system only (default for local dev)
  const currentId = `${os.platform()}-${os.arch()}`;
  echo(chalk.cyan`💻 Detected system: ${currentId}`);
  
  if (TARGETS[currentId]) {
    await setupTarget(currentId);
  } else {
    echo(chalk.red`❌ Current system ${currentId} is not in the supported download list.`);
    echo(`Supported targets: ${Object.keys(TARGETS).join(', ')}`);
    echo(`\nTip: Use --platform=<platform> to download for a specific platform`);
    echo(`     Use --all to download for all platforms`);
    process.exit(1);
  }
}

echo(chalk.green`\n🎉 Done!`);
