# Third-Party Notices

Runtime dependencies are installed from their respective npm packages and remain under their own licenses. This repository does not relicense those dependencies. Direct runtime dependencies at release preparation time are:

- `docx` — MIT
- `js-yaml` — MIT
- `jszip` — MIT or GPL-3.0-or-later (used under MIT)
- `pdf-parse` — MIT
- `pdfkit` — MIT

Their transitive dependencies retain their own notices and license terms. The authoritative dependency graph is `pnpm-lock.yaml`; the packed plugin does not vendor or modify these packages.

The public release does not include the local knowledge originals, migrated source excerpts, or book-derived reference materials used during private development.
