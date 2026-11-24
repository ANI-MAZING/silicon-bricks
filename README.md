# Plot Envelope · Bangkok

A browser feasibility studio for drawing a plot in the Rama 9 study area and comparing three building massing concepts under one explicit **พ.3 commercial / Bangkok 2013 plan scenario**.

This is a preliminary scenario tool. It does not identify a parcel's official zoning, certify current local overlays, establish legal road right-of-way or public-road status, verify a continuous fire access route, or issue a compliance / permit approval. Sources and modelling assumptions appear beside the results and in exported reports.

## Run

Use Node.js 22.12+ or 24+.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

The static production app is in `dist/`. Serve it over HTTP(S), not `file://`. No API keys, backend, account or environment variables are required. The optional street-tile layer uses OpenStreetMap; the baked buildings and roads work without tile requests.

## Workflow

1. Choose **Use sample plot**, or draw 3–100 corners inside the dashed study boundary. Finish with the first corner, double-click, Enter or **Finish**.
2. Drag a large corner to reshape; drag a small midpoint to insert a corner. Right-click a corner to remove it. Undo / redo recover plot edits and clearing. Cancel redraw retains the previous plot.
3. Choose building use and road. Correct the estimated right-of-way width with the slider or number field. The selected road's metric footprint changes with that value.
4. Select a concept in the comparison table. Its exact floor polygons and class-specific setback envelope appear on the map. FAR is a total area budget, not a unique maximum height.
5. Inspect model checks and sources. Save/open a portable JSON project, export an evidence report, or download the selected floor schedule as CSV.

Files are processed locally. Opening a project does not upload it to a server. Projects are not automatically persisted across reloads: use **Save project**.

## Model scope

- One named zone profile, พ.3; base FAR 7 and OSR 4.5%, from the 2013 plan clause 20. This is a selected historical-plan scenario, not a claim that the sample parcel is in that zone or that all provisions remain applicable today.
- Opening-bearing walls; no blank-wall exceptions. Whole-building setbacks: 3 m for the low-rise concept, 6 m around every floor of high-rise or extra-large concepts. A conservative footprint may exceed the minimum clearance for short buildings.
- High-rise threshold 23 m; extra-large threshold 10,000 m². Six-metre clearance includes the podium and road side. A low-rise over 10,000 m² is rebuilt with extra-large clearances.
- Road height plane and basic road setback are applied in a local metric frame, assuming a straight road parallel to one frontage and the parcel boundary on the road edge. Corner / multiple-road exceptions and future widening lines are not modelled.
- Residential / office concepts stop at 5,000 or 10,000 m² where the selected road does not satisfy the next พ.3 width band. No transit-distance exception is claimed. High-rise access constraints also limit concept generation; the independent checklist still checks the final result.
- Hotel concepts conservatively require 16 m road width because room count is not modelled. Podium commercial operating area is conservatively screened through the selected main-use budget; detailed mixed-use permissions remain outside scope.
- A 30% open-ground reservation is used for every use, conservatively including offices and hotels. OSR reserves ground for the full FAR budget, so low-utilisation designs can be smaller than strictly necessary. Half of OSR-required open space is reported as the minimum permeable planting reservation; actual landscape geometry is not designed or verified.
- Parking counts toward GFA. No FAR bonus, exemptions, basement, service equipment, structural / parking layouts, canal setbacks, protected-site overlays or survey-level fire route checks.
- Data coverage is approximately 0.9 × 0.9 km. Plots outside it receive a message rather than incomplete context. OSM footprints are contextual approximations. Missing heights use 12 m; level tags use 3.2 m per level.

## Architecture

- `src/core/geo.ts`: metric geometry, validation and polygon boolean operations.
- `src/core/rules.ts`: sourced numerical rules and conservative scenario choices.
- `src/core/envelope.ts`: geometric capacity plates and independent area budgets.
- `src/core/designs.ts`: three generators and independent checks. Concept B draws from spatial capacity, so its narrow tower can grow beyond A while respecting its own area budget.
- `src/core/model.ts`: one normalized model for all inputs.
- `src/core/model.worker.ts` and `src/ui/useModel.ts`: asynchronous calculations with revision checking; obsolete results are discarded. A synchronous fallback remains available when workers cannot initialize.
- `src/ui/MapView.tsx`: MapLibre, exact metric road surfaces, drawing, editing and rendering. MapLibre's worker is explicitly bundled; scoped CSS preserves map height after lazy stylesheet loading.
- `src/core/project.ts`: validated project loading and evidence / floor exports.

The map is loaded as a separate chunk so the control panel can appear first. Two map workers handle source processing; one calculation worker handles geometry. Polygon operations use millimetre integer coordinates. Insets use strips and boolean operations because the installed clipper2-js offset implementation was unreliable.

## Validation

`npm test` covers malformed / self-crossing / concave / narrow plots, randomized edits, supported coverage, FAR and OSR, whole-building clearances, high-rise and extra-large thresholds, independent tall-tower budgeting, exact floor arithmetic, road-size bands, project import validation and edit history. Production-browser checks are recorded in `docs/QA.md`.

`npm audit` currently reports Angular peer-dependency advisories through clipper2-js 1.2.4. This React app imports its pure geometry bundle, which has no Angular imports; Angular is not part of the production chunks. Upstream package metadata still installs those peers. This remains a dependency-maintenance limitation, not an audited security guarantee.

## Sources and attribution

See `docs/SOURCES.md` for clause locations, review date and limitations. Buildings and roads: © OpenStreetMap contributors, ODbL, retrieved 2026-11-24 via Overpass. `npm run bake` refreshes the same bounded extract and requires network access. MapLibre GL JS is BSD-3-Clause; clipper2-js is Boost Software License.

## Deployment

Deploy only the contents of `dist/` to a static host, or configure a Vite project with `npm run build` and output directory `dist`. Keep `.env*`, `gm_start.json`, raw transcripts and assignment credentials out of the deployment and repository. Build output contains no assignment MCP connection or credentials. The assignment submission is a separate action and is not triggered by this app.
