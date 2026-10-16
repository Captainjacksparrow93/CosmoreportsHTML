# Cosmo Reports — HTML

HTML versions of the CosmoKundli (CK) report designs, converted from the Figma files.

Each report lives on its own branch:

| Branch | Report | Pages |
|---|---|---|
| `ck-blueprint` | CK Blueprint | 11 |
| `ck-trajectory-intensity` | CK Trajectory Intensity | 17 |
| `ck-trajectory-vibes` | CK Trajectory Vibes | 11 |
| `ck-planner-max` | CK Planner Max | 16 |
| `ck-planner-plus` | CK Planner Plus | 12 |

Open `index.html` on a branch in a browser. Every page is an A4 sheet (1753 × 2480 design px), laid out exactly as in Figma, with real, selectable text in the Figma fonts (Poppins, Lexend Giga, Inter, Open Sans, Rubik; bundled in `assets/fonts`, so it works offline).

The toolbar has page navigation (also ← / → keys and `#page-N` links), zoom, fit-to-width and **Print / PDF**, which prints one A4 page per sheet.

## Regenerating from a .fig file

`tools/figma-to-html` holds the converter:

```sh
cd tools/figma-to-html && npm install
unzip My.fig -d work/            # canvas.fig + images/
node decode.js work/canvas.fig work/doc.json
node convert.js work/doc.json work/images out "Report title"
cp -r shared/assets out/          # css + js; add assets/fonts from a report branch
```
