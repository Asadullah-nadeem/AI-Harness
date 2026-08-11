#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "[-] Node.js is not installed or not in PATH. Please install Node.js first."
    exit 1
fi

# Determine project directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Install packages if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "[+] Installing packages..."
    npm install
fi

# Build project if not built
if [ ! -d "dist" ]; then
    echo "[+] Compiling TypeScript..."
    npm run build
fi

# Run CLI
echo "[+] Starting AI Harness..."
node dist/cli.js "$@"
