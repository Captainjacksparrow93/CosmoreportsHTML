# Cosmo Reports — HTML

HTML versions of the CosmoKundli (CK) report designs, converted from the Figma files.

Each report lives in its own folder, and is developed on its own branch:

| Folder / branch | Report | Pages |
|---|---|---|
| `ck-blueprint` | CK Blueprint | 11 |
| `ck-trajectory-intensity` | CK Trajectory Intensity | 17 |
| `ck-trajectory-vibes` | CK Trajectory Vibes | 11 |
| `ck-planner-max` | CK Planner Max | 16 |
| `ck-planner-plus` | CK Planner Plus | 12 |

Open `<folder>/index.html` in a browser. Each folder is self-contained (fonts, images, CSS and JS in its own `assets/`), so a report can be copied or hosted on its own.

Every page is an A4 sheet laid out as in Figma, with real, selectable text in the Figma fonts. The toolbar has page navigation (also ← / → keys and `#page-N` links), zoom, fit-to-width and **Print / PDF** (one A4 page per sheet).

## Changing the values

Every number shown in a chart lives in one file per report: `<folder>/assets/js/report-data.js`. Edit a value and reload the page — the design follows it:

- **Bar charts** (Blueprint Power & Flavour, Vibes): bar heights and the % labels above them. Use `null` for an N/A bar.
- **Daily curves** (Intensity): one value per day; the curve, area and dots are redrawn (a shorter list gives a shorter month).
- **5D bars** (Planner Max / Plus): bar length, the % value and the trend icon, which follows the 7 zones.
- **Sentiment** (−100 to 100): the liquid level and colour (green / red), the % value, the up/down arrow and the Positive / Negative label.
- **Situation** (0 to 100): the lit gauge zone, the needle, the % value and the label.

Each entry is named `Page N · <chart title>` so it is easy to find, for example:

```js
"Page 7 · Power - CosmoBal": {"Su": 21, "Mo": 70, "Ra": 54, ...},
"Page 10 · Situation": 95,
```

A web app can also pass data directly: `CKReport.render(newData)` redraws the report with the given values.
