#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const desktopDir = path.join(root, 'desktop');

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getNativeModules() {
  const packageJson = readJsonSafe(path.join(desktopDir, 'package.json')) || {};
  const deps = packageJson.dependencies || {};

  // 已知的 native 模块
  const knownNativeModules = ['node-pty', 'better-sqlite3', 'bcrypt'];

  return knownNativeModules.filter(mod => deps[mod]);
}

function checkRebuildCLI() {
  const result = spawnSync('npx', ['electron-rebuild', '--help'], {
    cwd: desktopDir,
    shell: process.platform === 'win32',
    stdio: 'pipe',
    encoding: 'utf8',
  });

  return {
    available: result.status === 0,
    version: result.status === 0 ? 'available' : null,
    error: result.status !== 0 ? result.stderr : null,
  };
}

function getElectronVersion() {
  const packageJson = readJsonSafe(path.join(desktopDir, 'package.json')) || {};
  const devDeps = packageJson.devDependencies || {};
  return devDeps.electron || 'unknown';
}

function getNodeVersion() {
  return process.version;
}

function buildElectronRebuildCheck(input = {}) {
  const nativeModules = getNativeModules();
  const rebuildCLI = checkRebuildCLI();
  const electronVersion = getElectronVersion();
  const nodeVersion = getNodeVersion();

  const checks = [
    {
      id: 'rebuild_cli',
      title: '@electron/rebuild CLI',
      status: rebuildCLI.available ? 'passed' : 'warning',
      detail: rebuildCLI.available
        ? `@electron/rebuild ${rebuildCLI.version} 可用`
        : `@electron/rebuild 不可用: ${rebuildCLI.error || '未安装'}`,
      nextAction: rebuildCLI.available
        ? '在授权环境执行 rebuild 命令。'
        : '运行: cd desktop && npm install',
    },
    {
      id: 'native_modules',
      title: 'Native 模块列表',
      status: nativeModules.length > 0 ? 'passed' : 'warning',
      detail: nativeModules.length > 0
        ? `发现 ${nativeModules.length} 个 native 模块: ${nativeModules.join(', ')}`
        : '未发现 native 模块',
      nextAction: '这些模块需要针对 Electron 重新编译。',
    },
    {
      id: 'electron_version',
      title: 'Electron 版本',
      status: electronVersion !== 'unknown' ? 'passed' : 'warning',
      detail: `Electron ${electronVersion}`,
      nextAction: 'rebuild 将针对此版本编译。',
    },
    {
      id: 'node_version',
      title: 'Node.js 版本',
      status: 'passed',
      detail: `Node.js ${nodeVersion}`,
      nextAction: '确保与 Electron 内置 Node 版本兼容。',
    },
  ];

  // 生成 rebuild 命令建议
  const rebuildCommand = nativeModules.length > 0
    ? `npx @electron/rebuild -f -w ${nativeModules.join(',')}`
    : 'npx @electron/rebuild -f';

  const rebuildInstructions = [
    '## Electron Rebuild 执行步骤',
    '',
    '### 1. 进入 desktop 目录',
    '```bash',
    'cd desktop',
    '```',
    '',
    '### 2. 确保依赖已安装',
    '```bash',
    'npm install',
    '```',
    '',
    '### 3. 执行 rebuild（需要编译工具链）',
    '```bash',
    rebuildCommand,
    '```',
    '',
    '### 4. 或使用 package.json 脚本',
    '```bash',
    'npm run rebuild',
    '```',
    '',
    '## 环境要求',
    '',
    '### Windows',
    '- Visual Studio Build Tools 2019 或更高版本',
    '- 或 Visual Studio 2019/2022（包含 C++ 桌面开发工作负载）',
    '- Python 3.x',
    '',
    '安装 Build Tools:',
    '```bash',
    'npm install --global windows-build-tools',
    '```',
    '',
    '或下载: https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022',
    '',
    '### macOS',
    '- Xcode Command Line Tools',
    '',
    '安装:',
    '```bash',
    'xcode-select --install',
    '```',
    '',
    '### Linux',
    '- build-essential (gcc, g++, make)',
    '- Python 3.x',
    '',
    '安装 (Ubuntu/Debian):',
    '```bash',
    'sudo apt-get install build-essential python3',
    '```',
    '',
    '## 注意事项',
    '',
    '- rebuild 过程可能需要 5-10 分钟',
    '- 需要管理员权限（Windows）或 sudo（Linux/macOS）',
    '- 首次编译会下载编译工具和头文件',
    '- 编译失败时检查环境要求是否满足',
  ].join('\n');

  const summary = {
    total: checks.length,
    passed: checks.filter(c => c.status === 'passed').length,
    warning: checks.filter(c => c.status === 'warning').length,
    failed: checks.filter(c => c.status === 'failed').length,
  };

  const status = summary.failed > 0 ? 'blocked' : summary.warning > 0 ? 'degraded' : 'ready';

  return {
    reportKind: 'electron-rebuild-check',
    createdAt: Number(input.createdAt || Date.now()),
    status,
    statusLabel: status === 'ready'
      ? 'Electron Rebuild 环境就绪'
      : status === 'degraded'
      ? 'Electron Rebuild 环境需复核'
      : 'Electron Rebuild 环境阻断',
    ready: summary.failed === 0,
    summary,
    checks,
    nativeModules,
    electronVersion,
    nodeVersion,
    rebuildCommand,
    rebuildInstructions,
  };
}

function writeElectronRebuildCheck(report, reportDir = path.join(root, '.codek', 'reports')) {
  fs.mkdirSync(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, 'electron-rebuild-check-latest.json');
  const markdownPath = path.join(reportDir, 'electron-rebuild-check-latest.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, `${toMarkdown(report)}\n`, 'utf8');
  return { report, jsonPath, markdownPath };
}

function toMarkdown(report) {
  return [
    '# Electron Rebuild 环境检查',
    '',
    `- 状态: ${report.statusLabel}`,
    `- Ready: ${report.ready ? 'YES' : 'NO'}`,
    `- Electron: ${report.electronVersion}`,
    `- Node.js: ${report.nodeVersion}`,
    `- Native 模块: ${report.nativeModules.join(', ') || '无'}`,
    '',
    '## 检查项',
    '',
    '| 检查项 | 状态 | 详情 | 下一步 |',
    '| --- | --- | --- | --- |',
    ...report.checks.map(c =>
      `| ${c.title} | ${c.status} | ${String(c.detail || '').replace(/\|/g, '\\|')} | ${String(c.nextAction || '').replace(/\|/g, '\\|')} |`
    ),
    '',
    '## Rebuild 命令',
    '',
    '```bash',
    'cd desktop',
    report.rebuildCommand,
    '```',
    '',
    report.rebuildInstructions,
  ].join('\n');
}

if (require.main === module) {
  const reportDirArg = process.argv.find(arg => arg.startsWith('--report-dir='));
  const reportDir = reportDirArg ? reportDirArg.slice('--report-dir='.length) : path.join(root, '.codek', 'reports');

  console.log('=== AT2: Electron Rebuild 环境验证 ===\n');

  const report = buildElectronRebuildCheck();
  const saved = writeElectronRebuildCheck(report, reportDir);

  console.log(`状态: ${report.statusLabel}`);
  console.log(`Electron: ${report.electronVersion}`);
  console.log(`Node.js: ${report.nodeVersion}`);
  console.log(`Native 模块: ${report.nativeModules.join(', ') || '无'}`);
  console.log(`总计: ${report.summary.total} | 通过: ${report.summary.passed} | 警告: ${report.summary.warning} | 失败: ${report.summary.failed}\n`);

  if (report.summary.warning > 0 || report.summary.failed > 0) {
    console.log('需要处理的项目:');
    report.checks
      .filter(c => c.status !== 'passed')
      .forEach(c => {
        console.log(`  [${c.status.toUpperCase()}] ${c.title}`);
        console.log(`    ${c.detail}`);
        console.log(`    → ${c.nextAction}\n`);
      });
  }

  console.log('Rebuild 命令:');
  console.log(`  cd desktop`);
  console.log(`  ${report.rebuildCommand}\n`);

  console.log(`报告已保存:`);
  console.log(`  JSON: ${saved.jsonPath}`);
  console.log(`  Markdown: ${saved.markdownPath}`);

  process.exit(report.summary.failed > 0 ? 1 : 0);
}

module.exports = {
  buildElectronRebuildCheck,
  writeElectronRebuildCheck,
};
