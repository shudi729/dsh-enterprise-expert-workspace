# Changelog

## 1.6.1 - 2026-11-12

- Corrected installation guidance for the GitHub-only release stage so users install the verified local tarball instead of an unpublished npm package.
- Made the cross-platform PDF test accept only two explicit outcomes: verified Chinese PDF generation when a CJK font exists, or a clear dependency error that prevents mojibake when it does not.
- Made release-note verification follow the package version instead of a hard-coded filename.

## 1.6.0 - 2026-11-12

- Prepared the first public, market-ready release under `dsh-enterprise-expert-workspace` with the Chinese display name “企业 AI 专家工作台”.
- Added a task-oriented Web workbench covering 10 business domains, 61 skills and 13 cross-domain workflows.
- Added persistent tasks, resumable drafts, knowledge review, artifact versions and verified downloads.
- Added idempotent submissions, comparison-basis guardrails, workspace isolation and model/calculation conflict checks.
- Replaced vulnerable spreadsheet and presentation dependencies with built-in Open XML readers and writers.
- Upgraded YAML parsing to a patched release; production dependency audit reports no known vulnerabilities at release preparation time.
- Added a Chinese user guide, real screenshots, security and privacy disclosures, market submission metadata and release checks.
- Excluded local knowledge originals, migrated source excerpts, credentials, logs, test profiles and private business data from the public package.
