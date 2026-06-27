#!/usr/bin/env bash
# Quick setup: generate cert and start server with HTTPS

set -e

echo "🔐 Generating TLS certificate..."
bash scripts/generate-cert.sh

echo ""
echo "🚀 Starting Jarvis with HTTPS..."
HTTPS=true bun start
