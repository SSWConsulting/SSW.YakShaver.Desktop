# Cross-Space Recording Overlay Persistence on macOS

> **R&D Core Activity** — [#921](https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/921) · FY2027

## Hypothesis

If the recording overlay window (indicator, timer, Stop button) is configured with the correct combination of window collection behaviour and level (e.g. `setVisibleOnAllWorkspaces` plus explicit handling of the fullscreen/multi-display interaction), then it will remain visible and interactive across all macOS Spaces and displays during a recording, because macOS's cross-Space window visibility for auxiliary/always-on-top windows is empirically inconsistent across OS versions and configurations rather than governed by one documented, universally-working recipe.

## Experiment log

<!-- Maintained by the rnd-experiment skill. Newest last. -->

| # | Experiment | Date | Status | Work item | PR |
| --- | --- | --- | --- | --- | --- |

## Folder layout

```
921-macos-cross-space-overlay/
├── README.md               ← this file (activity index)
├── 01-{{experiment-slug}}.md  ← one doc per experiment
├── 02-…
└── assets/                 ← evidence: test output, screenshots
    ├── 01-01-failing-tests.txt
    ├── 01-02-passing-tests.txt
    └── 01-03-feature-working.png
```
