# Carrier card pictures

Pictures on the homepage carrier cards (`ui/carrier-media.js`). They illustrate each carrier's kind of transport. They
never claim to show a specific shipment, and being listed does not mean a partnership (see the note under the cards).
Carrier names and liveries are trademarks of their respective owners.

| Files | Card | Source | Licence / permission |
| --- | --- | --- | --- |
| `ups-*` | UPS | Supplied by the site owner on 2026-10-19 (phone screenshot; photo area only, 1179×786, black margins removed, never upscaled). Shows UPS vehicles. | **Rights to be confirmed** |
| `emirates-*` | Emirates SkyCargo | Supplied by the site owner on 2026-10-19 (phone screenshot; photo area only, 1179×786). Shows an Emirates SkyCargo 777F. | **Rights to be confirmed** |
| `maersk-*` | Maersk | Supplied by the site owner on 2026-10-19 (phone screenshot; photo area only, 1179×1179). Shows a Maersk container ship. | **Rights to be confirmed** |

A picture showing a carrier's livery is used only on that carrier's own card. All other cards reuse the unbranded
pictures already on the site (`assets/freight/`, `assets/journey/`, `assets/stages/`, credited in those folders), each
with its own crop. To give a carrier its own picture, add `<id>-480`/`<id>-960` in AVIF, WebP and JPEG here, map it in
`ui/carrier-media.js`, and add a row to this table.
