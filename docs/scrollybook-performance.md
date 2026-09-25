# Scrollybook performance verification

`npm run qa:story:performance` runs the restored three-sample scroll cadence
benchmark. It remains part of local `npm run verify`; its original thresholds
are unchanged. Run it on the reference desktop browser before releasing story
animation or rendering changes.

CI retains its existing Core Web Vitals gate, including desktop and mobile
coverage. Story interaction, accessibility, scene transitions, and compact iPad
layout checks also run in CI through `qa:ui-critical:interaction`.

The September 2026 restoration initially added the historical cadence benchmark
to the newer CPU-only Linux deployment runner. That machine produced about
0.25–0.30 frame coverage despite zero long tasks, versus passing desktop samples.
Explicit CPU-compositing flags did not resolve the discrepancy; diagnostics
confirmed `gpu_compositing=disabled_software`. Those ineffective launch overrides
were removed. The hardware-sensitive cadence benchmark is therefore separate
from the existing CI deployment gate, rather than given weaker thresholds.

This is a coverage limitation: green CI does not establish smooth scrolling on
every graphics configuration. Preserve desktop cadence evidence and check the
published page at desktop and compact iPad widths before declaring a release
verified. Failure diagnostics include compositor status and rendering flags
when Chromium exposes them.
