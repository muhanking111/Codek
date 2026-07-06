#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function checkExists(id, title, filePath, nextAction) {
  const exists = fs.existsSync(filePath);
  return {
    id,
    title,
    status: exists ? 'passed' : 'warning',
    detail: exists ? `已找到 ${path.relative(root, filePath)}` : `缺少 ${path.relative(root, filePath)}`,
    nextAction: exists ? '继续保留在发布前预检中。' : nextAction,
    warningCategory: exists ? '' : 'packaging',
  };
}

function checkCommand(id, title, command, args, cwd, nextAction) {
  const result = spawnSync(command, args, {
    cwd,
    shell: process.platform === 'win32',
    stdio: 'pipe',
    encoding: 'utf8',
  });
  const passed = result.status === 0;
  return {
    id,
    title,
    status: passed ? 'passed' : 'warning',
    detail: passed
      ? `${command} ${args.join(' ')} 可执行。${result.stdout ? `版本: ${result.stdout.trim().split('\n')[0]}` : ''}`
      : `${command} ${args.join(' ')} 不可执行或返回 ${result.status ?? 'error'}。`,
    nextAction: passed ? '发布前仍需在授权环境运行真实打包。' : nextAction,
    warningCategory: passed ? '' : 'packaging',
  };
}

function buildPackagingPreflight(input = {}) {
  const packageJson = readJsonSafe(path.join(root, 'package.json')) || {};
  const desktopPackageJson = readJsonSafe(path.join(root, 'desktop', 'package.json')) || {};
  const scripts = packageJson.scripts || {};
  const desktopScripts = desktopPackageJson.scripts || {};
  const buildConfig = desktopPackageJson.build || {};

  const frontendDist = path.join(root, 'frontend', 'vite-project', 'dist', 'index.html');
  const desktopDir = path.join(root, 'desktop');

  const checks = [
    {
      id: 'pack_win_script',
      title: 'Windows 打包脚本',
      status: scripts['pack:win'] ? 'passed' : 'warning',
      detail: scripts['pack:win'] ? `pack:win=${scripts['pack:win']}` : 'package.json 缺少 pack:win。',
      nextAction: scripts['pack:win'] ? '发布前在授权环境运行 npm run pack:win。' : '补齐根 package.json 的 pack:win 脚本。',
      warningCategory: scripts['pack:win'] ? '' : 'packaging',
    },
    {
      id: 'desktop_build_config',
      title: 'Desktop 打包配置',
      status: buildConfig.appId && buildConfig.win ? 'passed' : 'warning',
      detail: buildConfig.appId
        ? `appId=${buildConfig.appId}, 已配置 ${Object.keys(buildConfig).filter(k => ['win', 'mac', 'linux'].includes(k)).join(', ')}`
        : 'desktop/package.json 缺少 build 配置。',
      nextAction: '补齐 electron-builder 配置。',
      warningCategory: buildConfig.appId ? '' : 'packaging',
    },
    checkExists('frontend_dist', '前端 dist 产物', frontendDist, '先运行 npm run build:frontend 或 npm run build。'),
    checkCommand(
      'electron_builder_cli',
      'electron-builder CLI',
      'npx',
      ['electron-builder', '--version'],
      desktopDir,
      '确认 desktop 依赖已安装: cd desktop && npm install'
    ),
    checkCommand(
      'electron_rebuild_cli',
      'electron-rebuild CLI',
      'npx',
      ['electron-rebuild', '--help'],
      desktopDir,
      '确认 desktop 依赖已安装，并在授权环境运行 electron-rebuild。'
    ),
  ];

  // 检查 CSP 注入
  const cspCheck = (() => {
    if (!fs.existsSync(frontendDist)) return null;
    const html = fs.readFileSync(frontendDist, 'utf8');
    const ok = html.includes('http-equiv="Content-Security-Policy"');
    return {
      id: 'frontend_csp',
      title: '前端 CSP 注入',
      status: ok ? 'passed' : 'warning',
      detail: ok ? 'dist/index.html 已包含 CSP meta。' : 'dist/index.html 未包含 CSP meta。',
      nextAction: ok ? '继续保留 CSP 注入检查。' : '运行 npm run build:frontend（会自动注入 CSP）。',
      warningCategory: ok ? '' : 'packaging',
    };
  })();
  if (cspCheck) checks.push(cspCheck);

  // 检查图标资源
  const iconChecks = [
    checkExists('icon_svg', 'SVG 图标源文件', path.join(root, 'desktop', 'assets', 'icon.svg'), '创建 desktop/assets/icon.svg。'),
    checkExists('icon_ico', 'Windows 图标', path.join(root, 'desktop', 'assets', 'icon.ico'), '从 SVG 转换或让 electron-builder 自动生成。'),
    checkExists('icon_icns', 'macOS 图标', path.join(root, 'desktop', 'assets', 'icon.icns'), '从 PNG 转换或让 electron-builder 自动生成。'),
    checkExists('icon_png', 'PNG 图标', path.join(root, 'desktop', 'assets', 'icon.png'), '从 SVG 转换: magick convert icon.svg -resize 512x512 icon.png'),
    checkExists('entitlements_mac', 'macOS Entitlements', path.join(root, 'desktop', 'assets', 'entitlements.mac.plist'), '创建 macOS entitlements 文件。'),
  ];
  checks.push(...iconChecks);

  const summary = {
    total: checks.length,
    passed: checks.filter((check) => check.status === 'passed').length,
    warning: checks.filter((check) => check.status === 'warning').length,
    failed: checks.filter((check) => check.status === 'failed').length,
  };

  const status = summary.failed > 0 ? 'blocked' : summary.warning > 0 ? 'degraded' : 'ready';

  return {
    reportKind: 'packaging-preflight',
    createdAt: Number(input.createdAt || Date.now()),
    status,
    statusLabel: status === 'ready' ? 'Windows 打包预检通过' : status === 'degraded' ? 'Windows 打包预检需复核' : 'Windows 打包预检阻断',
    ready: summary.failed === 0,
    summary,
    checks,
    warningPolicy: checks
      .filter((check) => check.status === 'warning')
      .map((check) => ({
        id: check.id,
        category: check.warningCategory || 'packaging',
        severity: 'warning',
        blocking: { quick: false, full: false, strict: true },
        nextAction: check.nextAction,
      })),
  };
}

function writePackagingPreflight(report, reportDir = path.join(root, '.codek', 'reports')) {
  fs.mkdirSync(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, 'packaging-preflight-latest.json');
  const markdownPath = path.join(reportDir, 'packaging-preflight-latest.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, `${toMarkdown(report)}\n`, 'utf8');
  return { report, jsonPath, markdownPath };
}

function readLatestPackagingPreflight(options = {}) {
  const reportDir = options.reportDir || path.join(root, '.codek', 'reports');
  const jsonPath = path.join(reportDir, 'packaging-preflight-latest.json');
  const markdownPath = path.join(reportDir, 'packaging-preflight-latest.md');
  if (!fs.existsSync(jsonPath)) return { report: null, jsonPath, markdownPath };
  return {
    report: readJsonSafe(jsonPath),
    jsonPath,
    markdownPath: fs.existsSync(markdownPath) ? markdownPath : '',
  };
}

function toMarkdown(report) {
  return [
    '# Windows 打包预检',
    '',
    `- 状态: ${report.statusLabel}`,
    `- Ready: ${report.ready ? 'YES' : 'NO'}`,
    `- 总计: ${report.summary.total} | 通过: ${report.summary.passed} | 警告: ${report.summary.warning} | 失败: ${report.summary.failed}`,
    '',
    '## 检查项',
    '',
    '| 检查项 | 状态 | 详情 | 下一步 |',
    '| --- | --- | --- | --- |',
    ...(report.checks || []).map((check) =>
      `| ${check.title} | ${check.status} | ${String(check.detail || '').replace(/\|/g, '\\|')} | ${String(check.nextAction || '').replace(/\|/g, '\\|')} |`
    ),
  ].join('\n');
}

if (require.main === module) {
  const reportDirArg = process.argv.find((arg) => arg.startsWith('--report-dir='));
  const reportDir = reportDirArg ? reportDirArg.slice('--report-dir='.length) : path.join(root, '.codek', 'reports');

  console.log('=== AT1: 发布候选配置盘点 ===\n');

  const report = buildPackagingPreflight();
  const saved = writePackagingPreflight(report, reportDir);

  console.log(`状态: ${report.statusLabel}`);
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

  console.log(`报告已保存:`);
  console.log(`  JSON: ${saved.jsonPath}`);
  console.log(`  Markdown: ${saved.markdownPath}`);

  process.exit(report.summary.failed > 0 ? 1 : 0);
}

module.exports = {
  buildPackagingPreflight,
  readLatestPackagingPreflight,
  writePackagingPreflight,
};
