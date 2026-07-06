#!/usr/bin/env node

/**
 * AT3 打包监控脚本
 * 用于监控 npm run pack:win 的执行进度
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const logFile = path.join(root, '.codek', 'reports', 'pack-win-output.log');

function ensureLogDir() {
  const logDir = path.dirname(logFile);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

function runPack() {
  ensureLogDir();

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         AT3: Windows 打包产物生成                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('开始打包，这可能需要 10-20 分钟...');
  console.log(`日志文件: ${logFile}`);
  console.log('');

  const logStream = fs.createWriteStream(logFile, { flags: 'w' });
  const startTime = Date.now();

  const proc = spawn('npm', ['run', 'pack:win'], {
    cwd: root,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout.on('data', (data) => {
    const text = data.toString();
    process.stdout.write(text);
    logStream.write(text);
  });

  proc.stderr.on('data', (data) => {
    const text = data.toString();
    process.stderr.write(text);
    logStream.write(text);
  });

  proc.on('close', (code) => {
    const duration = Math.round((Date.now() - startTime) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;

    logStream.end();

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`打包完成，耗时: ${minutes} 分 ${seconds} 秒`);
    console.log(`退出码: ${code}`);
    console.log(`日志文件: ${logFile}`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    if (code === 0) {
      console.log('✅ 打包成功！');
      console.log('');
      console.log('下一步:');
      console.log('  1. 检查产物: node scripts/at3-package-artifacts-check.js');
      console.log('  2. 查看产物: ls -lh desktop/release/');
      console.log('  3. 继续 AT4: 安装并测试产物');
    } else {
      console.log('❌ 打包失败！');
      console.log('');
      console.log('请检查日志文件以了解详细错误信息。');
      console.log('');
      console.log('常见问题:');
      console.log('  - 磁盘空间不足');
      console.log('  - native 模块编译失败（需要 Visual Studio Build Tools）');
      console.log('  - 前端 dist 未构建（运行 npm run build:frontend）');
    }

    process.exit(code);
  });
}

if (require.main === module) {
  runPack();
}

module.exports = { runPack };
