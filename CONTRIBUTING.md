# Contributing to easy.js
Thank you for helping make easy.js simple, secure, and useful.

## Development
```bash
npm install
npm run verify
npm test
```

## Language Changes
Language changes should update:

- `grammar/easyjs.ebnf`
- `docs/LANGUAGE_SPEC.md`
- `docs/RUNTIME_SEMANTICS.md`
- `docs/AST.md`
- `conformance/`
- parser/compiler tests

## Pull Request Checklist
- Keep syntax easy to read.
- Prefer secure defaults.
- Add or update tests.
- Update docs for user-facing behavior.
- Avoid committing secrets, generated logs, or local build output.

## Code Style
- Use CommonJS for framework runtime modules unless a package already uses another style.
- Keep errors human-readable.
- Keep generated starter projects small, obvious, and production-aware.

## Branch Protection and CI Workflow
To keep the `main` branch stable and production-ready, contributors should follow the workflow below.

### Protected Main Branch
The `main` branch is protected and should not receive direct pushes.

Contributors must:
- Fork the repository to their own GitHub account.
- Create a feature branch from `main`.
- Open a pull request for all changes.
- Wait for all required checks to pass.
- Request maintainer review before merging.

### Recommended Branch Naming
Use descriptive branch names such as:

- docs/branch-protection-ci-guide
- fix/cors-credentials
- feat/auth-state-store

### Pull Request Workflow
1. Fork the repository.
2. Clone your fork locally.
3. Create a new branch.
4. Make focused changes for a single issue.
5. Run relevant checks and tests.
6. Push the branch to your fork.
7. Open a pull request into `main`.
8. Include the related issue number (for example, `Fixes #17`).
9. Address review comments if requested.

### Required CI Checks
Before requesting review, ensure the following checks pass when applicable:

- Dependency installation
- Linting
- Type checking
- Unit tests
- Build verification
Pull requests should not be considered ready for review until required checks pass.

### Handling Failing CI
If CI fails:

1. Open the failed workflow logs.
2. Review the error messages carefully.
3. Fix the issue locally.
4. Re-run the relevant checks.
5. Commit and push the fix.

If a failure is unrelated to your changes, mention this in the pull request description or comments.

### Optional Provider Tests
Some integrations may require external providers or credentials.

If these tests are optional:
- Run them only when the relevant provider is configured.
- Clearly mention in the pull request if they were not executed.

### Live Adapter Tests
Some adapters depend on live services.

Before requesting review:
- Run live adapter tests when your changes affect adapter behavior.
- Skip them if no credentials or services are available.
- Note skipped tests in the pull request.

### Review Expectations
Contributors should:

- Keep pull requests focused on one issue.
- Write clear commit messages.
- Respond to review comments promptly.
- Avoid force-pushing after review unless necessary.

### Branch Protection Recommendations
Recommended protection settings for `main`:

- Require pull requests before merging.
- Require at least one approval.
- Require all status checks to pass.
- Dismiss stale approvals after new commits.
- Restrict direct pushes.
- Restrict force pushes.
