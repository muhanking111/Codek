#!/usr/bin/env node

/**
 * AT 线总执行脚本
 * 协调 AT0-AT7 所有阶段的执行和报告生成
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function runScript(scriptPath, description) {
  console.log(`\n=== ${description} ===`);
  const result = spawnSync('node', [scriptPath], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

function checkPackageArtifacts() {
  const releaseDir = path.join(root, 'desktop', 'release');
  if (!fs.existsSync(releaseDir)) return false;
  const files = fs.readdirSync(releaseDir);
  if (files.some(f => f.endsWith('.exe') || f.endsWith('.zip'))) return true;
  // 也检查 win-unpacked
  const unpackedExe = path.join(releaseDir, 'win-unpacked', 'Codek.exe');
  return fs.existsSync(unpackedExe);
}

function generateATSummary() {
  const reportDir = path.join(root, '.codek', 'reports');

  // 读取各阶段报告
  const reports = {
    at1: readReport(path.join(reportDir, 'packaging-preflight-latest.json')),
    at2: readReport(path.join(reportDir, 'electron-rebuild-check-latest.json')),
    at3: readReport(path.join(reportDir, 'package-artifacts-latest.json')),
    at4: readReport(path.join(reportDir, 'at4-install-smoke-latest.json')),
    at5: readReport(path.join(reportDir, 'at5-functional-smoke-latest.json')),
    at6: readReport(path.join(reportDir, 'at6-release-candidate-evidence-latest.json')),
    at7: readReport(path.join(reportDir, 'at7-release-candidate-runbook-latest.json')),
  };

  const summary = {
    reportKind: 'at-line-summary',
    createdAt: Date.now(),
    stages: {
      at0: { status: 'completed', title: '分发与部署形态定义' },
      at1: {
        status: reports.at1 ? 'completed' : 'pending',
        title: '发布候选配置盘点',
        ready: reports.at1?.ready || false,
      },
      at2: {
        status: reports.at2 ? 'completed' : 'pending',
        title: 'electron-rebuild 授权环境闭环',
        ready: reports.at2?.ready || false,
      },
      at3: {
        status: reports.at3 ? 'completed' : 'pending',
        title: 'Windows 打包产物生成',
        ready: reports.at3?.ready || false,
      },
      at4: {
        status: reports.at4 ? 'completed' : 'pending',
        title: '安装后首次启动 smoke',
        ready: reports.at4?.ready || false,
      },
      at5: {
        status: reports.at5 ? 'completed' : 'pending',
        title: '发布候选功能冒烟矩阵',
        ready: reports.at5?.ready || false,
      },
      at6: {
        status: reports.at6 ? 'completed' : 'pending',
        title: '发布候选证据链',
        ready: reports.at6?.overall?.status !== 'blocked' || false,
      },
      at7: {
        status: reports.at7 ? 'completed' : 'pending',
        title: '回滚与分发说明',
        ready: (reports.at7?.evidenceSummary?.overallStatus) ? reports.at7.evidenceSummary.overallStatus !== 'blocked' : (reports.at7?.ready || false),
      },
    },
    overallStatus: determineOverallStatus(reports),
  };

  // 保存总结报告
  const summaryPath = path.join(reportDir, 'at-line-summary-latest.json');
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');

  return summary;
}

function readReport(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function determineOverallStatus(reports) {
  const hasArtifacts = checkPackageArtifacts();
  const at3Ready = reports.at3?.ready || false;
  const at4Ready = reports.at4?.ready !== undefined ? reports.at4.ready : reports.at4?.status !== 'blocked';
  const at5Ready = reports.at5?.ready || false;
  const at6Ok = reports.at6?.overall?.status !== 'blocked';
  const at7Ready = reports.at7?.ready !== undefined ? reports.at7.ready : true;

  if (hasArtifacts && at3Ready && at4Ready && at5Ready && at6Ok && at7Ready) {
    return 'at0-at7-completed';
  }

  if (hasArtifacts && reports.at1?.ready && reports.at2?.ready && at3Ready) {
    return 'ready-for-at4';
  }

  if (reports.at1?.ready && reports.at2?.ready) {
    return 'ready-for-at3';
  }

  if (reports.at1 && reports.at2) {
    return 'at0-at2-completed';
  }

  return 'in-progress';
}

function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         AT 线：真实发布候选与可安装桌面包闭环             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const args = process.argv.slice(2);
  const stage = args[0] || 'summary';

  switch (stage) {
    case 'at1':
      runScript(path.join(root, 'scripts', 'packaging-preflight.js'), 'AT1: 发布候选配置盘点');
      break;

    case 'at2':
      runScript(path.join(root, 'scripts', 'electron-rebuild-check.js'), 'AT2: electron-rebuild 环境验证');
      break;

    case 'at3':
      if (!checkPackageArtifacts()) {
        console.log('\n⚠️  未发现打包产物，需要先运行: npm run pack:win');
        console.log('打包可能需要 10-20 分钟，请耐心等待...\n');
      }
      runScript(path.join(root, 'scripts', 'at3-package-artifacts-check.js'), 'AT3: Windows 打包产物检查');
      break;

    case 'all':
      console.log('\n执行 AT1-AT3 完整流程...\n');
      runScript(path.join(root, 'scripts', 'packaging-preflight.js'), 'AT1: 发布候选配置盘点');
      runScript(path.join(root, 'scripts', 'electron-rebuild-check.js'), 'AT2: electron-rebuild 环境验证');

      if (checkPackageArtifacts()) {
        runScript(path.join(root, 'scripts', 'at3-package-artifacts-check.js'), 'AT3: Windows 打包产物检查');
      } else {
        console.log('\n⚠️  跳过 AT3：未发现打包产物');
        console.log('运行 npm run pack:win 后再执行 AT3\n');
      }
      break;

    case 'summary':
    default:
      const summary = generateATSummary();
      console.log('\n=== AT 线执行状态 ===\n');

      Object.entries(summary.stages).forEach(([key, stage]) => {
        const icon = stage.status === 'completed' ? '✅' : '⏳';
        const readyText = stage.ready !== undefined ? (stage.ready ? ' [READY]' : ' [DEGRADED]') : '';
        console.log(`${icon} ${key.toUpperCase()}: ${stage.title}${readyText}`);
      });

      console.log(`\n总体状态: ${summary.overallStatus}`);
      console.log(`\n报告目录: ${path.join(root, '.codek', 'reports')}`);

      console.log('\n可用命令:');
      console.log('  node scripts/at-line.js at1      - 运行 AT1 预检');
      console.log('  node scripts/at-line.js at2      - 运行 AT2 验证');
      console.log('  node scripts/at-line.js at3      - 运行 AT3 产物检查');
      console.log('  node scripts/at-line.js all      - 运行 AT1-AT3');
      console.log('  node scripts/at-line.js summary  - 显示状态总结');
      break;
  }
}

if (require.main === module) {
  main();
}

module.exports = { generateATSummary, checkPackageArtifacts };
