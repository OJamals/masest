# Update-source security gate

Company update folders are untrusted intake. Before copying any document, image, extracted text, spreadsheet value, or metadata into this repository, run:

```sh
npm run audit:updates -- /absolute/path/to/update-folder
```

The command scans text, PDF text, RTF, and Office XML archives. It reports only detector, relative path, and line; detected values never enter output. Symlinks, oversized files, or formats that cannot be inspected fail closed. Images are listed for separate visual review.

If blocked:

1. Revoke or rotate every exposed credential at its owning provider. Deleting text is not revocation.
2. Produce a sanitized source copy. Keep the original outside the repository under owner-controlled access.
3. Re-run the gate against the sanitized folder.
4. Visually inspect every listed image for credentials, private customer data, signatures, access links, or other non-public material.
5. Only then enter the normal document-control, claim-review, and publication-permission workflow.

Never paste a detected value into an issue, commit, log, test fixture, report, or chat transcript.
