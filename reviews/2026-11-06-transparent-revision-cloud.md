# Transparent revision clouds

User instruction: “The background needs to be transparent by necessity.”

- Outcome: revision clouds outline visible content; new, reopened and restyled clouds have transparent interiors.
- Scope: cloud creation and existing scene reconciliation; other marks retain their fills.
- Independent correctness review: no material findings after tracing creation, import, reconciliation, save, copy, PDF, Send and duplication. `git diff --check` passed. Busy edits defer reconciliation until settled, as before.
- Fresh removal review: remove the explicit transparent creation option because `createLineElement()` already defaults to transparent. Accepted; deleted the former solid-fill override instead.
- Browser regression check: all ten checks passed: new transparency with opaque outline, closed scallops, save/reopen with number and note, older-cloud correction, other shape fills, stable reconciliation, style-fill correction, export dimensions, 20,000 unchanged interior pixels and retained export note data.
- Test setup corrections: the initial geometry comparison ignored normal import-coordinate restoration, and a second mark's badge initially extended export bounds. Corrected the comparisons and fixture; neither failure required a product change.
- Build: `scripts/build-app.sh` passed, including the release Swift build and stable-signature verification. After the removal recommendation, `node build.mjs` rebuilt the final editor successfully. Existing package advisories and SDK linker search-path warnings did not prevent the build; dependencies were unchanged.
- Recovery: revert this change and reinstall the previous signed app. Editable pictures, cloud geometry, numbers and notes retain their existing format.
