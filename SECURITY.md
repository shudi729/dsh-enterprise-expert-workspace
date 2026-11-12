# Security Policy

## Supported version

Security fixes are applied to the latest published minor release. Older unpublished builds and development snapshots are not supported.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not include API keys, customer data, credentials, or private documents in a public issue.

For ordinary bugs without sensitive information, open a GitHub issue with the DSH version, plugin version, operating system, reproduction steps, and sanitized logs.

## Data and credentials

This plugin does not package credentials. Model access is delegated to the DSH profile's credential and LLM services. Uploaded files and generated artifacts may contain sensitive business information; operators are responsible for profile access controls, backups, retention, and authorized use.

The plugin does not include advertising or first-party telemetry. When a task uses an externally configured model, relevant task content is sent through the DSH `llm` service to that provider. External actions and connector configuration are denied by default and require explicit authorization.

## Release safeguards

Before release, maintainers run the automated test suite, production dependency audit, package-content review, secret and local-path scan, and installation from the packed `.tgz` in an isolated DSH profile. Online market scanning remains authoritative for the final published tarball.
