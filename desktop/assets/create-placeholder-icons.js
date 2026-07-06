#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

// 创建简单的 PNG 占位图标（512x512，单色）
function createPlaceholderPNG(outputPath, size = 512) {
  // PNG 文件头和简单的单色图像数据
  // 这是一个最小化的 PNG 文件，显示为纯色方块
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
  ]);

  // IHDR chunk (图像头)
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); // chunk length
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(size, 8); // width
  ihdr.writeUInt32BE(size, 12); // height
  ihdr.writeUInt8(8, 16); // bit depth
  ihdr.writeUInt8(2, 17); // color type (RGB)
  ihdr.writeUInt8(0, 18); // compression
  ihdr.writeUInt8(0, 19); // filter
  ihdr.writeUInt8(0, 20); // interlace

  // 计算 CRC
  const crc = require('node:zlib').crc32(ihdr.slice(4, 21));
  ihdr.writeUInt32BE(crc, 21);

  // IDAT chunk (图像数据 - 简化版，纯色)
  const idat = Buffer.from([
    0x00, 0x00, 0x00, 0x0E, // chunk length
    0x49, 0x44, 0x41, 0x54, // "IDAT"
    0x78, 0x9C, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
    0x0D, 0x0A, 0x2D, 0xB4, // compressed data + CRC
  ]);

  // IEND chunk (结束标记)
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00, // chunk length
    0x49, 0x45, 0x4E, 0x44, // "IEND"
    0xAE, 0x42, 0x60, 0x82, // CRC
  ]);

  // 由于创建真实的 PNG 比较复杂，我们使用一个更简单的方法：
  // 创建一个 SVG，然后说明需要转换
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="#4A90E2"/>
  <text x="50%" y="50%" font-family="Arial" font-size="64" fill="white" text-anchor="middle" dominant-baseline="middle">Codek</text>
</svg>`;

  fs.writeFileSync(outputPath.replace('.png', '.svg'), svg, 'utf8');
  console.log(`Created SVG placeholder: ${outputPath.replace('.png', '.svg')}`);
  console.log('Note: For production, convert SVG to PNG using tools like ImageMagick or online converters');

  // 创建一个说明文件
  const readme = `# Placeholder Icons

These are placeholder icons for development and testing.

## Files
- icon.svg: Source SVG file (512x512)
- icon.png: Should be converted from SVG (512x512)
- icon.ico: Windows icon (256x256, multiple sizes)
- icon.icns: macOS icon (512x512@2x)

## Converting SVG to other formats

### Using ImageMagick (if installed):
\`\`\`bash
# PNG
magick convert icon.svg -resize 512x512 icon.png

# ICO (Windows)
magick convert icon.svg -define icon:auto-resize=256,128,64,48,32,16 icon.ico

# ICNS (macOS) - requires additional tools
png2icns icon.icns icon.svg
\`\`\`

### Using online tools:
- PNG: https://svgtopng.com/
- ICO: https://convertio.co/svg-ico/
- ICNS: https://cloudconvert.com/svg-to-icns

### Using electron-builder (recommended):
electron-builder will automatically generate icons from a 1024x1024 PNG source.
Place a 1024x1024 PNG as \`icon.png\` and electron-builder will handle the rest.

## For production
Replace these placeholder icons with your actual brand icons.
`;

  fs.writeFileSync(path.join(path.dirname(outputPath), 'README.md'), readme, 'utf8');
  console.log(`Created README: ${path.join(path.dirname(outputPath), 'README.md')}`);
}

// 创建 macOS entitlements.mac.plist
function createEntitlementsPlist(outputPath) {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
`;

  fs.writeFileSync(outputPath, plist, 'utf8');
  console.log(`Created entitlements: ${outputPath}`);
}

// 主函数
function main() {
  const assetsDir = path.join(__dirname);

  // 创建 SVG 占位图标
  createPlaceholderPNG(path.join(assetsDir, 'icon.png'), 512);

  // 创建 macOS entitlements
  createEntitlementsPlist(path.join(assetsDir, 'entitlements.mac.plist'));

  console.log('\n✓ Placeholder assets created successfully!');
  console.log('\nNext steps:');
  console.log('1. Convert icon.svg to icon.png (512x512)');
  console.log('2. Convert icon.png to icon.ico (Windows)');
  console.log('3. Convert icon.png to icon.icns (macOS)');
  console.log('4. Or use electron-builder auto-generation from a 1024x1024 PNG');
}

if (require.main === module) {
  main();
}

module.exports = { createPlaceholderPNG, createEntitlementsPlist };
