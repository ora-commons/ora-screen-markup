# Public release 0.1.0 (ORA-303)

- Change: `CFBundleShortVersionString` 1.0 → 0.1.0 (the About window reads it), and the README restructured as the landing page and starting guide for the public download — download and unzip, move to Applications, the one-time Privacy & Security allowance (not Apple-notarized yet), Screen Recording, capturing and marking up, Export PDF, Save/Open Editable Drawing, finding the version, updating by replacing the app, removing via the Trash. The existing capture documentation and the build-and-install section stay below the guide.
- Release archive: built ad hoc (`ORA_SCREEN_MARKUP_SIGN_IDENTITY=-`, no `--install`) in a detached worktree at `/private/tmp/ora-screen-markup-0.1.0`; zipped with `ditto -c -k --sequesterRsrc --keepParent`; 16,270,233 bytes, SHA-256 `a71fbe44e5eefd80d5c165c0164168399c96dd06fd733d0400ac6c751424c9b1`. The same bytes are bundled into Vibe Coder 0.5.0.
- The initial implementation reported zero findings from the exporter refusal check over the unpacked app's 246 files. Verification did not find its saved output; its independent scan found no prohibited private material. The documentation correction below does not rerun that check.
- Independent review (Codex gpt-6.1-sol, effort xhigh, Agent Bridge, 7 November) of both ORA-303 candidates: no findings against this repository's diff. The removal-only pass that followed recommended nothing to remove from it.

## Documentation correction

- R1 — FIXED in the private candidate — added the unchanged sibling CC0 `LICENSE`, `NOTICE.md` covering first-party source, documentation and the existing 0.1.0 app, and README licence links. Excalidraw, bundled fonts, Rock Salt and other bundled editor dependencies retain their own licences.
- R2 — FIXED in the private candidate — the README links to the public Issues page and says reports are handled as capacity allows, with no support promised.
- Direct checks: the CC0 licence matches Vibe Coder's byte for byte; README licence links and notice source paths resolve; the build scripts place bundled third-party notices in the app's `Contents/Resources/THIRD_PARTY_NOTICES.txt`; the README names the public Issues route and support limits. No runtime files changed, so no test or build ran.
- Delivery: Reviewed private documentation correction; public publication awaits the owner's choice of release route. The release archive, tags, Vibe Coder and installed apps are unchanged.
- Current private-candidate review (fresh Codex reviewers, configured models; effective slugs unexposed): implementation CONTINUE / SETTLED, no findings; removal-only DONE / SETTLED, no recommendations. Public delivery remains pending.
