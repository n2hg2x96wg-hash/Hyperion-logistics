# Stage pictures (tracking result)

Pictures shown for a shipment's recorded stage in the tracking result (`tracker/scene.js`). They illustrate the kind of
place or vehicle for that stage; they never claim to show the actual facility, vessel or parcel.

| Files | Used for | Source | Licence / permission |
| --- | --- | --- | --- |
| `dock-*` | Shipment registered and Processing | Supplied by the site owner on 2026-10-18 (phone screenshot, photo area only, 1179 px wide; looks like a 3D render) | **Rights to be confirmed** |
| `aerial-*` | At a facility | Supplied by the site owner on 2026-10-18 (phone screenshot, photo area only, 1179 px wide; looks AI-generated or rendered) | **Rights to be confirmed** |
| `dc-*` | Not used any more (kept on file) | Supplied by the site owner on 2026-10-18 (phone screenshot, photo area only, 1179 px wide) | **Rights to be confirmed** |
| `bays-*` | Not used any more (kept on file) | Supplied by the site owner on 2026-10-18 (looks like a 3D render) | **Rights to be confirmed** |
| `forklift-342.*` | Not used any more (kept on file) | Thumbnail cropped from the owner's stage mock-up (342×250, low resolution) | **Rights to be confirmed** |
| `campus-*` | Customs | Supplied by the site owner on 2026-10-18; carried a Google Gemini mark (AI-generated), cropped out | **Rights to be confirmed** |
| `ship-342.*` | In transit by sea (with the recorded checkpoints drawn over it) | Thumbnail cropped from the owner's stage mock-up (342×250, low resolution) | **Rights to be confirmed** |
| `air-342.*` | In transit by air | Thumbnail cropped from the owner's stage mock-up (342×250, low resolution) | **Rights to be confirmed** |
| `dusk-*` | Out for delivery | Supplied by the site owner on 2026-10-18 (photo area only, 1179 px wide) | **Rights to be confirmed** |

The three 342 px thumbnails look soft on large screens. Replace them with originals of at least 1200 px when available,
keeping the same file names.

## 3D scenes

The interactive 3D scenes (`tracker/3d/`) are built entirely in code: geometry, materials and textures are generated
at runtime from seeded noise. They use no third-party models, textures or images. Three.js (MIT licence) is loaded
from jsDelivr. Vehicles, vessels, aircraft and buildings are generic and unbranded.
