#!/usr/bin/env zx

import 'zx/globals';

const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;
const JIT_RELEASE_BASE_URL = 'https://github.com/zjfjiayou/jit-cli/releases';

const TARGETS = {
  'darwin-arm64': {
    filename: 'jit-darwin-arm64.tar.gz',
    binName: 'jit',
  },
  'darwin-x64': {
    filename: 'jit-darwin-amd64.tar.gz',
    binName: 'jit',
  },
  'linux-arm64': {
    filename: 'jit-linux-arm64.tar.gz',
    binName: 'jit',
  },
  'linux-x64': {
    filename: 'jit-linux-amd64.tar.gz',
    binName: 'jit',
  },
  'win32-arm64': {
    filename: 'jit-windows-arm64.zip',
    binName: 'jit',
  },
  'win32-x64': {
    filename: 'jit-windows-amd64.zip',
    binName: 'jit',
  },
};

const PLATFORM_GROUPS = {
  mac: ['darwin-x64', 'darwin-arm64'],
  win: ['win32-x64', 'win32-arm64'],
  linux: ['linux-x64', 'linux-arm64'],
};

function getOutputBinName(id) {
  return id.startsWith('win32-') ? 'jit.exe' : 'jit';
}

function resolveDownloadUrl(filename) {
  if (jitVersion === 'latest') {
    return `${JIT_RELEASE_BASE_URL}/latest/download/${filename}`;
  }
  return `${JIT_RELEASE_BASE_URL}/download/v${jitVersion}/${filename}`;
}

async function downloadArchive(downloadUrl, archivePath, timeoutMs) {
  echo`⬇️ Downloading: ${downloadUrl}`;
  const response = await fetch(downloadUrl, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${downloadUrl}: HTTP ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  await fs.writeFile(archivePath, Buffer.from(buffer));
}

async function setupTarget(id) {
  const target = TARGETS[id];
  if (!target) {
    echo(chalk.yellow`⚠️ Target ${id} is not supported by this script.`);
    return;
  }

  const outputBinName = getOutputBinName(id);
  const targetDir = path.join(OUTPUT_BASE, id);
  const tempDir = path.join(ROOT_DIR, 'temp_jit_extract', id);
  const stagingDir = path.join(ROOT_DIR, 'temp_jit_stage', id);
  const archivePath = path.join(ROOT_DIR, target.filename);
  const stagedBin = path.join(stagingDir, outputBinName);
  const destBin = path.join(targetDir, outputBinName);
  const downloadUrl = resolveDownloadUrl(target.filename);
  const downloadTimeoutMs = Number.parseInt(process.env.CLAWX_JIT_DOWNLOAD_TIMEOUT_MS || '', 10) || DEFAULT_DOWNLOAD_TIMEOUT_MS;

  echo(chalk.blue`\n📦 Setting up jit-cli for ${id}...`);

  if (await fs.pathExists(destBin)) {
    await fs.remove(destBin);
  }
  await fs.remove(tempDir);
  await fs.remove(stagingDir);
  await fs.ensureDir(targetDir);
  await fs.ensureDir(tempDir);
  await fs.ensureDir(stagingDir);

  try {
    await downloadArchive(downloadUrl, archivePath, downloadTimeoutMs);

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

    const files = await glob(`**/${target.binName}*`, { cwd: tempDir, absolute: true });
    const sourceBin = files.find((filepath) => path.basename(filepath) === target.binName)
      ?? files.find((filepath) => path.basename(filepath) === `${target.binName}.exe`);

    if (!sourceBin) {
      throw new Error(`Could not find ${target.binName} in extracted files.`);
    }

    await fs.move(sourceBin, stagedBin, { overwrite: true });

    if (!id.startsWith('win32-')) {
      await fs.chmod(stagedBin, 0o755);
    }

    await fs.move(stagedBin, destBin, { overwrite: true });
    echo(chalk.green`✅ Success: ${destBin}`);
  } finally {
    await fs.remove(archivePath);
    await fs.remove(tempDir);
    await fs.remove(stagingDir);
  }
}

const downloadAll = argv.all;
const platform = argv.platform;
const requestedVersion = typeof argv.version === 'string' ? argv.version.trim() : '';
const jitVersion = requestedVersion || process.env.CLAWX_JIT_VERSION?.trim() || 'latest';
const jitVersionLabel = jitVersion === 'latest' ? 'latest' : `v${jitVersion}`;

if (downloadAll) {
  echo(chalk.cyan`🌐 Downloading jit-cli ${jitVersionLabel} binaries for all supported platforms...`);
  for (const id of Object.keys(TARGETS)) {
    await setupTarget(id);
  }
} else if (platform) {
  const targets = PLATFORM_GROUPS[platform];
  if (!targets) {
    echo(chalk.red`❌ Unknown platform: ${platform}`);
    echo(`Available platforms: ${Object.keys(PLATFORM_GROUPS).join(', ')}`);
    process.exit(1);
  }

  echo(chalk.cyan`🎯 Downloading jit-cli ${jitVersionLabel} binaries for platform: ${platform}`);
  echo(`   Architectures: ${targets.join(', ')}`);
  for (const id of targets) {
    await setupTarget(id);
  }
} else {
  const currentId = `${os.platform()}-${os.arch()}`;
  echo(chalk.cyan`💻 Detected system: ${currentId}`);
  echo(`   jit-cli version: ${jitVersionLabel}`);

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
