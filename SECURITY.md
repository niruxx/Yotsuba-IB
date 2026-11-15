# Security maintenance

Run `npm ci` to install the reviewed lockfile, `npm run audit` to check known npm advisories, and `npm test` before deploying. The audit fails on any reported severity, including optional dependencies. An audit service error also fails the check; it is not a clean result.

CI audits pull requests, dependency changes and a daily schedule. Dependabot proposes weekly npm, Docker and GitHub Actions updates once the configuration is on the default branch. Updates require review and passing checks; nothing automatically merges or deploys. Enable Dependabot alerts and security updates in the repository's GitHub security settings for advisory-triggered patch pull requests.

When an advisory appears:

1. Inspect `npm audit` and the upstream advisory to establish affected versions and exposure.
2. Apply compatible fixes with `npm audit fix`, or explicitly update the affected direct dependency. Avoid blanket `npm audit fix --force`: it can introduce breaking changes.
3. Review changes to both package.json and package-lock.json, run the tests, and repeat the audit.
4. Back up deployed data, deploy the reviewed revision and restart the service. Rebuild Docker images with `docker build --pull` to refresh the base image and OS packages.

Keep Node.js on a maintained release and install security patches for Node.js, ffmpeg and the host OS. npm audit checks known dependency advisories; it does not certify application security, detect all malicious packages or scan operating-system packages.

The local security review added regression coverage for board-scoped administration and alerts, malformed CSRF tokens and authenticated-page caching. This is a focused review, not a complete penetration test.
