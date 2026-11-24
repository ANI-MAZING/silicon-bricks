# Release verification · 1.0.0

Date: 2026-11-25, Asia/Kolkata.

## Automated checks

- TypeScript and Vite production build pass. Both geometry and MapLibre worker assets are emitted explicitly.
- 86 tests pass across rule / geometry, product regression and store suites. The former generic three-zone test matrix has been replaced by the supported named-zone matrix and additional behavioural regressions.
- Coverage includes independent concept FAR budgets, tall tower growth above the broad scheme, whole-building6m clearances, extra-large low-rise classification, road-width bands, per-floor accounting, invalid inputs, missing roads, study limits, project import validation and edit recovery with road assumptions.

## Browser checks against production output

Tested at `127.0.0.1:4173` using the built `dist/`, rather than the development server.

- Sample: three nonempty concepts. On the default24m road, broad concept9,991m² /41.6m; slim tower about10,000m² /48.0m; low-rise7,599m² /22.4m. All implemented model checks pass. These are scenario outputs, not survey or permit conclusions.
- Changing road width to8m restricts office schemes to5,000m² and below23m; changing to30m restores the higher area budget. Rapid hotel/office changes settle on the latest selection.
- Clear → Undo restores the boundary. Self-crossing drawing produces an explicit error; Undo recovers the prior plot. Escape from the focused redraw control cancels without losing the existing boundary.
- Save project triggers a JSON download. Clear → Open project restores the saved boundary and settings. Export report and selected concept CSV trigger valid downloads; JSON and CSV contents were checked locally.
- Desktop1440×900 and phone390×844: no horizontal document overflow. Canvas height matches map-stage height at both sizes. The side panel scrolls independently, while map controls remain reachable.
- Production map renders real context, selected design, envelope, corner handles and metric road surfaces. Fresh release tab reports no console errors or warnings during the tested flow.
- Optional local diagnostics (`?diagnostics=1`) observed82 camera-motion frame intervals, average8.42ms, worst17.50ms in the test browser. This is a short local observation, not a cross-device performance guarantee. Geometry runs in a dedicated worker with stale-result rejection.

## Issues found and corrected during release testing

- MapLibre6's implicit worker path broke after bundling. The worker is now an explicit Vite asset.
- Lazy-loaded MapLibre CSS overrode `.map` positioning, collapsing the map container to zero height. Scoped stage sizing now takes precedence.
- Redraw cancellation and double-click finishing could lose geometry. Existing plots survive cancellation and double-click completion retains corners.
- Slim towers were previously limited to the broad scheme's FAR-truncated floor count. Each concept now spends its own budget over available spatial capacity.
- High-rise clearances were applied only above23m. They now govern all floors of the regulated building, including its podium and front boundary.

## Release limitations

Public source: https://github.com/ANI-MAZING/silicon-bricks . Public app: https://ani-mazing.github.io/silicon-bricks/ . GitHub Actions run45470541623 passed the clean install,86 tests, production build, dependency audit and Pages deployment. The public app was opened without sign-in; map workers loaded and all three sample concepts passed model checks with no browser errors. Vercel authorization is not needed for this GitHub Pages deployment. No assignment submission is performed.

Legal / survey limitations and the vendored geometry dependency provenance are documented in README, SOURCES and vendor/clipper2-js/UPSTREAM.md. npm audit reports zero vulnerabilities after removing the unused obsolete Angular peers. Neither passing tests nor reading a statutory figure establishes a complete legal compliance assessment.

## Public repository review

- Added exact road-to-plot segment distances so short nearby roads and crossing segments are not missed. Frontage matching samples the edge interior instead of ranking a shared corner alone.
- Net and core totals are verified separately, preventing equal-and-opposite total errors from passing. Open ground uses the actual projected polygon union in both UI and exports.
- Resize handling stops an old-viewport camera animation before recalculating the map dimensions.
- The unmodified pure geometry kernel is vendored with licence and SHA-256 provenance; the package wrapper no longer pulls obsolete unused Angular peers. A clean install, build, tests and npm audit are required by the public CI workflow.
