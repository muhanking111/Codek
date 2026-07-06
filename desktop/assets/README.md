# Placeholder Icons

These are placeholder icons for development and testing.

## Files
- `icon.svg`: Source SVG file (512x512) - **Currently available**
- `icon.png`: Should be converted from SVG (512x512) - **Needs conversion**
- `icon.ico`: Windows icon (256x256, multiple sizes) - **Needs conversion**
- `icon.icns`: macOS icon (512x512@2x) - **Needs conversion**

## Converting SVG to other formats

### Option 1: Using ImageMagick (if installed)
```bash
# PNG
magick convert icon.svg -resize 512x512 icon.png

# ICO (Windows)
magick convert icon.svg -define icon:auto-resize=256,128,64,48,32,16 icon.ico

# ICNS (macOS) - requires additional tools
png2icns icon.icns icon.png
```

### Option 2: Using online tools
- PNG: https://svgtopng.com/
- ICO: https://convertio.co/svg-ico/
- ICNS: https://cloudconvert.com/svg-to-icns

### Option 3: Using electron-builder (recommended)
electron-builder can automatically generate icons from a 1024x1024 PNG source.
Place a 1024x1024 PNG as `icon.png` and electron-builder will handle the rest.

## Current Status
- ✅ SVG placeholder created
- ✅ macOS entitlements.mac.plist created
- ⚠️ PNG/ICO/ICNS need manual conversion or electron-builder auto-generation

## For production
Replace these placeholder icons with your actual brand icons.
