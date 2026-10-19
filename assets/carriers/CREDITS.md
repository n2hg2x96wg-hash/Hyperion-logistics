# Carrier card pictures

Pictures on the homepage carrier cards (`ui/carrier-media.js`). They illustrate each carrier's kind of transport. They
never claim to show a specific shipment, and being listed does not mean a partnership (see the note under the cards).
Carrier names and liveries are trademarks of their respective owners.

| Files | Card | Source | Licence / permission |
| --- | --- | --- | --- |
| `ups-*` | UPS | Supplied by the site owner on 2026-10-19 (phone screenshot; photo area only, 1179×786, black margins removed, never upscaled). Shows UPS vehicles. | **Rights to be confirmed** |
| `emirates-*` | Emirates SkyCargo | Supplied by the site owner on 2026-10-19 (phone screenshot; photo area only, 1179×786). Shows an Emirates SkyCargo 777F. | **Rights to be confirmed** |
| `maersk-*` | Maersk | Supplied by the site owner on 2026-10-19 (phone screenshot; photo area only, 1179×1179). Shows a Maersk container ship. | **Rights to be confirmed** |

Carrier pictures and shipment-stage pictures are kept separate. Carrier cards use only the files in this folder,
looked up by carrier id in `ui/carrier-media.js`. The tracking result uses only `assets/stages/`, chosen from the
shipment's recorded status in `tracker/scene.js`. A carrier without its own photo shows an original drawn illustration
of its transport category (code-drawn SVG, generic and unbranded), never a stage photo or another carrier's photo.

To give a carrier its own photo, add `<name>-480`/`<name>-960` in AVIF, WebP and JPEG here, map it by carrier id in
`CARRIER_PHOTOS` in `ui/carrier-media.js`, and add a row to this table.
