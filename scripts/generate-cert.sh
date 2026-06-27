#!/usr/bin/env bash
# Generate self-signed TLS certificate for local development

set -e

CERT_DIR="./certs"
mkdir -p "$CERT_DIR"

# Generate private key and certificate
openssl req -x509 -newkey rsa:2048 \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -days 365 \
  -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "✅ Generated self-signed certificate in $CERT_DIR/"
echo "   key.pem: $CERT_DIR/key.pem"
echo "   cert.pem: $CERT_DIR/cert.pem"
echo ""
echo "Run with HTTPS:"
echo "   HTTPS=true bun start"
echo ""
echo "Note: Accept the security warning in your browser"
