# Repository agent instructions

## Branch safety

Before changing implementation files, run `git branch --show-current`.

Implementation work must not be done on `main`. If the current branch is `main`, create or switch to a feature branch before editing. Implementation files include source, tests, migrations, executable schemas, and build or deployment configuration.

## Development documentation

The canonical Rostrum product strategy, roadmap, technical Epics, implementation plans, human-readable specifications, decisions, and research live in [`RostrumAI/rostrum-dev-docs`](https://github.com/RostrumAI/rostrum-dev-docs).

Before planning or implementation, read that repository's `README.md`, methodology, roadmap, relevant technical Epics, active plans, specifications, and decisions.

Do not recreate development planning documents in this repository. Keep source comments, API documentation generated from code, executable schemas, migrations, tests, fixtures, licensing, security information, and essential setup instructions with the implementation.
