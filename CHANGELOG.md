# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Separate CI jobs for Rust, web UI, native adapters (with ASan/UBSan) and examples.
- CodeQL analysis, Dependabot configuration and a security policy.

### Changed
- `uart-pty` adapter builds the shared bridge via `add_subdirectory`.
- Workspace `rust-version` aligned with the pinned 1.91.1 toolchain; repository metadata corrected.
