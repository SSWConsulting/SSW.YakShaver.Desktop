# Reliable Recording Session State & Overlay UX on Desktop

> **R&D Core Activity** — [#921](https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/921) · FY2027

## Hypothesis

If YakShaver Desktop's recording session — its state machine and its overlay UI — is hardened against the specific edge cases that leave the Stop control unusable (OS-level window/Space interference on macOS; a device/audio setup step that never completes) rather than fixed one incident at a time, then the Stop control stays reachable and functional across both known failure classes and, by extension, whichever similar edge case surfaces next, because the underlying question in both cases is the same: does the app's recording lifecycle have a single, guaranteed path back to a safe idle/interactive state regardless of what interrupted it?

This activity was broadened from a narrower one (originally filed as just the macOS cross-Space overlay bug) to also cover #956 — a related, already-shipped fix for the "audio never opened" stuck-Stop-button case — once it became clear both are the same underlying reliability question rather than two unrelated bugs.

## Experiment log

<!-- Maintained by the rnd-experiment skill. Newest last. -->

| # | Experiment | Date | Status | Work item | PR |
| --- | --- | --- | --- | --- | --- |
| — | Harden `stop()` against incomplete audio/recorder setup | — | ✅ Successful (shipped) | #956 | — (predates this activity's docs folder) |

## Folder layout

```
921-recording-session-reliability/
├── README.md               ← this file (activity index)
├── 01-{{experiment-slug}}.md  ← one doc per experiment (cross-Space overlay facet)
├── 02-…
└── assets/                 ← evidence: test output, screenshots
    ├── 01-01-failing-tests.txt
    ├── 01-02-passing-tests.txt
    └── 01-03-feature-working.png
```
