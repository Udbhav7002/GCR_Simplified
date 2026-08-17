# GitHub Repository Secrets — Release Signing Setup

For the `Release` workflow (`.github/workflows/release.yml`) to produce working installers
and update manifests, add these secrets to **Settings → Secrets and variables → Actions →
New repository secret** on `Udbhav7002/GCR_Simplified`.

## 1. Updater signing key (required for auto-updates)

Generate once, then keep the private key safe:

```bash
npm install -g @tauri-apps/cli
npx tauri signer generate -w ~/.tauri/gcr_simplified.key
```

- `TAURI_SIGNING_PRIVATE_KEY` — file contents of `~/.tauri/gcr_simplified.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you set (empty string if none)

> The public key is already embedded in `src-tauri/tauri.conf.json` →
> `plugins.updater.pubkey`. Do not regenerate it without updating that value.

## 2. macOS code signing + notarization (required to avoid Gatekeeper warnings)

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | Base64 of your **Developer ID Application** `.p12` (`base64 -i cert.p12`) |
| `APPLE_CERTIFICATE_PASSWORD` | The `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | The Apple ID used for notarization |
| `APPLE_PASSWORD` | An **app-specific password** for that Apple ID (not your normal password) |
| `APPLE_TEAM_ID` | Your Apple Developer Team ID |

Without these, macOS builds still produce a `.dmg`, but Gatekeeper will warn that the app is
from an unidentified developer.

## 3. Windows code signing (optional but recommended)

The `tauri-action` does not sign Windows binaries with an OV certificate out of the box. To
avoid SmartScreen warnings, sign the `.exe`/`.msi` with a code-signing certificate (e.g. via
`signtool` in a dedicated step) and add the certificate/secret accordingly.

## 4. Releasing

```bash
# bump version in src-tauri/tauri.conf.json and package.json
git tag v0.1.1
git push origin v0.1.1
```

The workflow builds installers for macOS (universal via two targets), Windows, and Linux,
attaches them to a **draft release**, and publishes the update manifest to the same release.
