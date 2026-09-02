# Security Policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/nicanor-korir/merge-files-locally/security/advisories/new)
rather than opening a public issue.

Please include what you were doing, what happened, and — if the issue involves a crafted
document — the smallest file that reproduces it. You will get an acknowledgement within a few
days.

## What this project guarantees

The privacy claim is enforced, not merely intended:

- **`connect-src 'self'`** in the Content-Security-Policy blocks every outbound `fetch`, `XHR`
  and beacon. User files physically cannot be uploaded or exfiltrated, even if a bug or a
  malicious document tried. The policy ships both as an HTTP header (`vercel.json`) and as a
  `<meta>` tag, so it holds even from `file://` or a non-Vercel static host.
- **No server.** The app is a static export. There is no backend, no database, no logging and
  no analytics — there is nowhere for a file to go.
- **The service worker only ever caches the app's own assets.** It handles same-origin `GET`
  requests for files that shipped with the build. User documents never traverse the network at
  all, so they never reach it.

You can verify all of this yourself: open DevTools, add some files, and merge. The Network tab
should show no requests beyond the app's own assets.

## Known accepted trade-offs

- **`script-src` includes `'unsafe-inline'`.** Next.js static export inlines its hydration
  bootstrap, and nonces are not available without a server. This is a real relaxation, and it
  is accepted because `connect-src 'self'` still makes egress impossible — inline script that
  ran would have nowhere to send anything.
- **Preview rendering executes untrusted PDFs in the browser.** That is inherent to showing a
  preview at all. The mitigation is to keep pdf.js current — it tracks the latest `pdfjs-dist`
  (v6), so upstream parser fixes such as CVE-2024-4367 are picked up rather than worked around.

## Scope

In scope: anything that could cause a user's file to leave their device, arbitrary code
execution from a crafted PDF or image, or a bypass of the Content-Security-Policy.

Out of scope: issues that require a compromised browser or operating system, and reports that
amount to "the site does not set header X" without a demonstrated impact.
