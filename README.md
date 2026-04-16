# Direktvermarktung Virtuallogger ModbusTCP VPN

A configurable Modbus TCP bridge with web interface for energy and industrial applications.

## Warning / Disclaimer

This project is provided **as-is** for testing, development, and experimental use.

- **No warranty is provided**
- **No guarantee is provided**
- **No liability is assumed for any damage, loss, downtime, security issue, misconfiguration, incorrect measurement, or incorrect control behavior**
- **This project has not been fully security-audited**
- **It must not be considered secure by default**
- **Anyone using this project does so entirely at their own risk**
- **Use in production environments, critical infrastructure, industrial control, or energy systems is done at the user's own responsibility**

By using this repository, software, scripts, or configuration examples, you agree that you are solely responsible for testing, validation, deployment, network exposure, firewalling, access control, and operational safety.

## Project purpose

This project is intended to become a configurable Modbus TCP bridge / virtual logger with a web interface.

The goal is to allow users to configure Modbus TCP sources and register definitions through a UI instead of hardcoding values.  
It is designed for energy, industrial, plant, and direct-marketing related scenarios and should support reusable templates/profiles for providers, plant types, and device setups.

## Current state

The project already includes:

- Node.js + Express backend
- Web UI
- Modbus TCP communication layer
- Register decoding
- Runtime polling
- Runtime status API
- CRUD foundations for sources, registers, profiles, and settings
- JSON-based local persistence
- Export / import endpoints
- Profile application support

## Important security note

This repository is currently intended primarily for development and controlled testing.

Before any real deployment, the following should be reviewed and hardened:

- authentication / authorization
- network exposure
- HTTPS / reverse proxy security
- firewalling
- input validation edge cases
- rate limiting
- error handling
- secret management
- production logging strategy
- safe Modbus timeout / retry behavior

Do **not** assume this software is secure simply because it runs locally.

## One-command install

### curl

```bash
curl -fsSL https://raw.githubusercontent.com/matnig/direktvermarktung-virtuallogger-modbustcp-vpn/main/install.sh | bash
