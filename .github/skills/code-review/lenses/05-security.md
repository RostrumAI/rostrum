# Lens: security

Read `reviewer-contract.md` and these rules: `rules/repository-conventions.md`.

Your angle is whether the change can be made to do something the author did not intend. You are not
looking for defects that are merely bugs; a defect becomes your finding when an attacker can choose
the input.

## Activate when

The diff touches request handling, authentication or authorization, network calls, database
queries, file or process access, serialization, secrets, configuration, logging, or dependencies.
Skip the lens when the change is confined to tests, documentation, formatting, or pure in-memory
computation with no external input.

## What to check

1. **Untrusted input.** Every value reaching the change from a request, a header, a query string, a
   file, or another service is validated before use. Report a path where an unvalidated value
   reaches a query, a path, a command, a redirect, a template, or a deserializer.
2. **Injection.** String-built SQL, shell commands assembled from input, path joins with a
   caller-supplied segment, regular expressions compiled from input, and template or markup
   interpolation of unescaped values.
3. **Access control.** A route, operation, or repository method reachable without the authorization
   the surrounding code assumes. A lookup by identifier that does not also scope to the caller's
   tenant, owner, or workspace.
4. **Secrets.** A credential, token, key, or connection string committed, logged, echoed in an error
   response, or interpolated into a message. A configuration value with a real credential as its
   default.
5. **Transport and trust.** A service call that skips certificate verification, a development
   exemption that also applies to a remote address, a trust decision made from a caller-supplied
   header, an internal endpoint bound to a public interface without authentication.
6. **Resource limits.** An unbounded loop, allocation, recursion, or query result driven by input.
   A body, page size, or timeout with no ceiling.
7. **Serialization.** Trusting a deserialized value's shape, a prototype-polluting merge of input
   into an object, and a parser configured to evaluate rather than parse.
8. **Dependencies.** A new dependency added without need, pinned loosely, or duplicating something
   already present. A dependency change that alters the lockfile unrelated to the change's purpose.
9. **Logging and errors.** An error response that discloses internals, a log record that includes
   a secret or personal data, and a failure path that continues with attacker-influenced state.
10. **Test and debug affordances.** A bypass flag, seed endpoint, fake credential, or debug route
    that could reach a deployed environment.

## How to work

For each finding, name the attacker's input, the path it takes through the changed code, and the
capability it gains. A security finding without that chain is a hunch; drop it.

Do not report a theoretical weakness the code already guards elsewhere. Read the caller and the
middleware before claiming a route is unauthenticated.

Report `SEC` as the rule id, or a `REPO-*` id when a repository rule covers the issue.
