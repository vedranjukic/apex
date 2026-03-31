#!/bin/bash
set -e

echo "🔨 Building Apex CLI with Bun..."

# Create dist directory
mkdir -p dist

# Build for multiple platforms
echo "📦 Building binaries..."

# Linux x64
echo "  → Linux x64"
bun build --compile --target=bun-linux-x64 src/main.ts --outfile dist/apex-linux-x64

# Linux ARM64 (if supported by Bun)
if bun build --compile --target=bun-linux-arm64 src/main.ts --outfile dist/apex-linux-arm64 2>/dev/null; then
    echo "  → Linux ARM64"
else
    echo "  ⚠️  Linux ARM64 not supported by this Bun version"
fi

# macOS ARM64 (Apple Silicon)
echo "  → macOS ARM64"
bun build --compile --target=bun-darwin-arm64 src/main.ts --outfile dist/apex-darwin-arm64

# macOS x64 (Intel)
echo "  → macOS x64"
bun build --compile --target=bun-darwin-x64 src/main.ts --outfile dist/apex-darwin-x64

# Make binaries executable
chmod +x dist/apex-*

echo "✅ Build complete! Binaries created in dist/"
ls -la dist/

echo ""
echo "📊 Binary sizes:"
du -h dist/apex-*