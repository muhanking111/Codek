#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');

function getFileHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function getFileSize(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stats = fs.statSync(filePath);
  return stats.size;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function findPackageArtifacts() {
  const releaseDir = path.join(root, 'desktop', 'release');
  if (!fs.existsSync(releaseDir)) {
    return { found: false, releaseDir, artifacts: [] };
  }

  const artifacts = [];

  // 1. 顶层安装器（NSIS Setup .exe）
  const topFiles = fs.readdirSync(releaseDir).filter(f => {
    const p = path.join(releaseDir, f);
    return fs.statSync(p).isFile() && (f.endsWith('.exe') || f.endsWith('.zip') || f.endsWith('.dmg') || f.endsWith('.AppImage') || f.endsWith('.deb'));
  });
  topFiles.forEach(f => {
    const fp = path.join(releaseDir, f);
    artifacts.push({
      name: f,
      path: fp,
      size: getFileSize(fp),
      sizeFormatted: formatBytes(getFileSize(fp)),
      hash: getFileHash(fp),
      type: 'installer',
      ext: path.extname(f).slice(1),
    });
  });

  // 2. win-unpacked 免安装包
  const unpackedDir = path.join(releaseDir, 'win-unpacked');
  if (fs.existsSync(unpackedDir)) {
    const codekExe = path.join(unpackedDir, 'Codek.exe');
    if (fs.existsSync(codekExe)) {
      artifacts.push({
        name: 'win-unpacked/Codek.exe',
        path: codekExe,
        size: getFileSize(codekExe),
        sizeFormatted: formatBytes(getFileSize(codekExe)),
        hash: getFileHash(codekExe),
        type: 'unpacked',
        ext: 'exe',
      });
    }
  }

  return { found: artifacts.length > 0, releaseDir, unpackedDir, artifacts };
}

function buildPackageArtifactsReport(input = {}) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8'));
  const version = packageJson.version;
  const appId = packageJson.build?.appId || 'unknown';

  const artifactsResult = findPackageArtifacts();

  const checks = [
    {
      id: 'release_dir',
      title: '发布目录',
      status: fs.existsSync(artifactsResult.releaseDir) ? 'passed' : 'failed',
      detail: fs.existsSync(artifactsResult.releaseDir)
        ? `发布目录存在: ${artifactsResult.releaseDir}`
        : `发布目录不存在: ${artifactsResult.releaseDir}`,
      nextAction: fs.existsSync(artifactsResult.releaseDir)
        ? '继续检查产物。'
        : '运行 npm run pack:win 生成产物。',
    },
    {
      id: 'artifacts_found',
      title: '打包产物',
      status: artifactsResult.found ? 'passed' : 'failed',
      detail: artifactsResult.found
        ? `发现 ${artifactsResult.artifacts.length} 个产物`
        : '未发现打包产物',
      nextAction: artifactsResult.found
        ? '验证产物完整性。'
        : '运行 npm run pack:win 生成产物。',
    },
  ];

  // 为每个产物添加检查项
  artifactsResult.artifacts.forEach((artifact, index) => {
    checks.push({
      id: `artifact_${index}`,
      title: `产物: ${artifact.name}`,
      status: 'passed',
      detail: `大小: ${artifact.sizeFormatted}, SHA256: ${artifact.hash.slice(0, 16)}...`,
      nextAction: '产物已生成，可进行安装测试。',
    });
  });

  const summary = {
    total: checks.length,
    passed: checks.filter(c => c.status === 'passed').length,
    warning: checks.filter(c => c.status === 'warning').length,
    failed: checks.filter(c => c.status === 'failed').length,
  };

  const status = summary.failed > 0 ? 'blocked' : summary.warning > 0 ? 'degraded' : 'ready';

  return {
    reportKind: 'package-artifacts',
    createdAt: Number(input.createdAt || Date.now()),
    status,
    statusLabel: status === 'ready' ? '打包产物已生成' : status === 'degraded' ? '打包产物需复核' : '打包产物缺失',
    ready: summary.failed === 0,
    version,
    appId,
    releaseDir: artifactsResult.releaseDir,
    summary,
    checks,
    artifacts: artifactsResult.artifacts,
  };
}

function writePackageArtifactsReport(report, reportDir = path.join(root, '.codek', 'reports')) {
  fs.mkdirSync(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, 'package-artifacts-latest.json');
  const markdownPath = path.join(reportDir, 'package-artifacts-latest.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, `${toMarkdown(report)}\n`, 'utf8');
  return { report, jsonPath, markdownPath };
}

function toMarkdown(report) {
  const lines = [
    '# AT3: Windows 打包产物报告',
    '',
    `- 状态: ${report.statusLabel}`,
    `- Ready: ${report.ready ? 'YES' : 'NO'}`,
    `- 版本: ${report.version}`,
    `- App ID: ${report.appId}`,
    `- 发布目录: ${report.releaseDir}`,
    '',
    '## 检查项',
    '',
    '| 检查项 | 状态 | 详情 | 下一步 |',
    '| --- | --- | --- | --- |',
    ...report.checks.map(c =>
      `| ${c.title} | ${c.status} | ${String(c.detail || '').replace(/\|/g, '\\|')} | ${String(c.nextAction || '').replace(/\|/g, '\\|')} |`
    ),
  ];

  if (report.artifacts && report.artifacts.length > 0) {
    lines.push('', '## 产物详情', '');
    report.artifacts.forEach(artifact => {
      lines.push(`### ${artifact.name}`, '');
      lines.push(`- **类型**: ${artifact.type.toUpperCase()}`);
      lines.push(`- **大小**: ${artifact.sizeFormatted} (${artifact.size} bytes)`);
      lines.push(`- **SHA256**: \`${artifact.hash}\``);
      lines.push(`- **路径**: \`${artifact.path}\``);
      lines.push('');
    });
  }

  return lines.join('\n');
}

if (require.main === module) {
  const reportDirArg = process.argv.find(arg => arg.startsWith('--report-dir='));
  const reportDir = reportDirArg ? reportDirArg.slice('--report-dir='.length) : path.join(root, '.codek', 'reports');

  console.log('=== AT3: Windows 打包产物检查 ===\n');

  const report = buildPackageArtifactsReport();
  const saved = writePackageArtifactsReport(report, reportDir);

  console.log(`状态: ${report.statusLabel}`);
  console.log(`版本: ${report.version}`);
  console.log(`发布目录: ${report.releaseDir}`);
  console.log(`总计: ${report.summary.total} | 通过: ${report.summary.passed} | 警告: ${report.summary.warning} | 失败: ${report.summary.failed}\n`);

  if (report.artifacts.length > 0) {
    console.log('发现的产物:');
    report.artifacts.forEach(artifact => {
      console.log(`  - ${artifact.name} (${artifact.sizeFormatted})`);
      console.log(`    SHA256: ${artifact.hash.slice(0, 32)}...`);
    });
    console.log('');
  }

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
  buildPackageArtifactsReport,
  writePackageArtifactsReport,
  findPackageArtifacts,
};
