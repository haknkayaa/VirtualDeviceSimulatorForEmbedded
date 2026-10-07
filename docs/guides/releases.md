# Releases

VDS4E publishes Debian packages from Git tags. The release workflow is defined
in `.github/workflows/release.yml`.

## Version source

The release tag must match the workspace version in the root `Cargo.toml`.

For example, a workspace version of `0.1.0` requires the tag:

```text
v0.1.0
```

A mismatched tag fails before package creation.

## Prepare a release

Before tagging, ensure the intended commit is on `main` and run the normal
verification described in [Testing VDS4E](testing.md).

The staged build should also succeed:

```shell
./configure
./build.sh
```

Review `CHANGELOG.md` and confirm the workspace version before creating the
tag.

## Create the tag

```shell
git checkout main
git pull --ff-only
git tag v0.1.0
git push origin v0.1.0
```

Treat published release tags as immutable. If follow-up changes are needed,
prepare a new version instead of moving an existing release tag.

## What the workflow does

The tag-triggered workflow runs on Ubuntu 22.04 and:

1. validates that the tag version matches the Cargo workspace version;
2. runs `./configure` and `./build.sh`;
3. builds the Debian package with `packaging/debian/build-deb.sh`;
4. inspects the package and verifies its SHA-256 checksum;
5. installs the package into the runner and smoke-tests commands and installed
   files;
6. creates or updates the matching GitHub Release.

Expected assets for version `X.Y.Z` are:

```text
vds4e_X.Y.Z_amd64.deb
vds4e_X.Y.Z_amd64.deb.sha256
```

## Local package build

After a successful staged build:

```shell
./packaging/debian/build-deb.sh 0.1.0
```

The package is written below `dist/`.

Install it locally with:

```shell
sudo apt install ./dist/vds4e_0.1.0_amd64.deb
vds-server --config /etc/vds4e/vds-server.yaml --check-config
```

Package installation does not automatically load `cuse` or `gpio-sim`.
Those remain explicit host capabilities/privileges.
