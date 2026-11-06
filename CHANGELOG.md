# Changelog

## 0.1.9 - 2026-11-06

### Changed

- Consolidated all MCP sources under `src/`: `docs`, `system1`, and `control`.
- Removed redundant license/provenance docs; the package is GPL-3.0-only via the
  root `LICENSE`.
- Narrowed the npm tarball to runtime artifacts; `test/` is no longer tracked.
- CI now typechecks, builds and packs without relying on test files.
- Removed stale control `fetch_proto.py` and nested readme.

## 0.1.1 - 2026-11-05

### Added

- Split child/profile/env logic into `src/children.mjs` with unit tests.
- Added `vendor/PROVENANCE.md`, `THIRD_PARTY_NOTICES.md`, `SECURITY.md` and
  `scripts/sync-vendor.sh` for reproducible vendoring.
- CI now runs unit tests and `npm pack` on Node 20/22.

### Changed

- Release workflow uses `npm ci --ignore-scripts` and tests before packing.
- Explicit npm installer metadata and files list.

## 0.1.0 - 2026-11-05

### Added

- Unified `roboparty-mcp` MCP entry with namespaced `docs_*`, `control_*` and
  `system1_*` tools.
- `--profile` selection and `--check` child/tool health check.
- `--setup` delegates to the control MCP Python runtime setup.
- Control credentials are injected only into the control child.

### Notes

- The npm package now vendors docs and System-1 bundles plus the control Python
  source under `vendor/`; it no longer depends on the three standalone MCP
  packages.
- The Laya model and Python dependencies are not bundled; use `--setup` and
  pre-provision `LAYA_CACHE`.
