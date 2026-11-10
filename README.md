# Public documentation renderer test

This is a disposable public test of a portable Astro/Starlight renderer. Atlas, Beacon and Compass are fictional projects. Real project documentation and deployment credentials are not included. The GitLab deployment control plane remains private.

Docker is the only local prerequisite. After the v0.1.0 image has been made public:

```sh
docker run --rm -p 4321:4321 -v docs-poc-cache:/cache/docs-renderer ghcr.io/lccc-andy-buchanan/docs-poc-renderer:v0.1.0
```

Open http://localhost:4321. The renderer fetches all three projects at runtime. Its named cache survives container removal; restart to refresh remote refs, or use `docs-renderer preview --offline` to reuse cached snapshots.

To edit Atlas, clone only its docs repository and run `docker compose up docs-preview` there. Atlas is mounted read-only with live reload; the other two projects come from the cache or public Git. No renderer checkout or registry login is required.

The portable commands are `docs-renderer preview`, `docs-renderer build`, and `docs-renderer prepare`; `--sources`, `--override slug=/container/docs/path` and explicit directory manifests are supported. Run `sh scripts/test-renderer.sh` for fixture and source-cache tests. These are the same runtime/build scripts as the private renderer release, with example branding and source catalogue.

## Releases and organisation portability

The GitHub Actions workflow calls `scripts/build-image.sh`. Branches and PRs validate and build without publishing. Version tags publish ARM64 and AMD64 images, labelled with their exact source commit. The image name derives from `github.repository` and is lowercased, so the same workflow works under an organisation. `GITHUB_TOKEN` needs `packages: write`; no personal publishing token is used. Newly created GHCR packages start private: an administrator must make the test package public once.

Under an organisation, an owner must create/allow the public repository, permit the selected Actions and public packages, and give this repository access to its package. Update source catalogue URLs and image references when changing namespace. Consumer Git/OCI interfaces stay the same.
