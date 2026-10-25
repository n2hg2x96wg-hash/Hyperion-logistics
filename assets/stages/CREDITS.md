# Stage pictures (tracking result)

Photographs shown for a shipment's recorded stage in the tracking result (`tracker/scene.js`). They show the kind of
place or vehicle for that stage; the caption under them says they are representative photos, never the actual
facility, vessel, vehicle or parcel.

Every photo is in the **public domain** or dedicated to it under **CC0 1.0**, as stated on its Wikimedia Commons file
page (read on 2026-10-25). None requires attribution, so the tracking page shows no credit line. Each was made from
Commons' 1920 px rendition (the customs photo from its 1280 px one), cropped to 16:10 and exported at 720 and 1280 px
wide in AVIF, WebP and JPEG, metadata stripped, never upscaled.

| Files | Used for | Source (Wikimedia Commons file page) | Author | Licence |
| --- | --- | --- | --- | --- |
| `stage-warehouse-*` | Shipment registered, Processing, in transit with no recorded mode, Delayed, Cancelled | [Pallets for Gustav.jpg](https://commons.wikimedia.org/wiki/File:Pallets_for_Gustav.jpg) | Jacinta Quesada / FEMA | Public domain (work of a US federal employee) |
| `stage-facility-*` | At a facility, On hold | [Emergency Planning and Security - San Juan, Puerto Rico, May 29, 2012 -- FEMA's Logistics Management Division … Caribbean Distribution Cen - DPLA - d2c4633e1ec7478e8b435ea7ddbce4ce.jpg](https://commons.wikimedia.org/wiki/File:Emergency_Planning_and_Security_-_San_Juan,_Puerto_Rico,_May_29,_2012_--_FEMA%27s_Logistics_Management_Division_open_the_agency%27s_new,_strategically-located_Caribbean_Distribution_Cen_-_DPLA_-_d2c4633e1ec7478e8b435ea7ddbce4ce.jpg) | FEMA | Public domain (work of a US federal employee) |
| `stage-customs-*` | Customs | [U S Customs & Border Protection Port of New York - Newark Resumes Vessel and Cargo Container Inspection Following Hurricane Sandy (8167655254).jpg](https://commons.wikimedia.org/wiki/File:U_S_Customs_%26_Border_Protection_Port_of_New_York_-_Newark_Resumes_Vessel_and_Cargo_Container_Inspection_Following_Hurricane_Sandy_(8167655254).jpg) | CBP Photography | Public domain (work of a US federal employee) |
| `stage-sea-*` | In transit by sea (with the recorded checkpoints drawn over it) | [Nordica (ship, 2011) (IMO 9483695, MMSI 244201000) Container Ship approaching Port of Rotterdam photo 7.jpg](https://commons.wikimedia.org/wiki/File:Nordica_(ship,_2011)_(IMO_9483695,_MMSI_244201000)_Container_Ship_approaching_Port_of_Rotterdam_photo_7.jpg) | Alf van Beem | CC0 1.0 |
| `stage-air-*` | In transit by air | [McDonnell Douglas DC-8-62H(F) Silverback Cargo Freighters landing at Bruxelles.jpg](https://commons.wikimedia.org/wiki/File:McDonnell_Douglas_DC-8-62H(F)_Silverback_Cargo_Freighters_landing_at_Bruxelles.jpg) | Alf van Beem | CC0 1.0 |
| `stage-road-*` | In transit by road | [Highway 395, Indio, United States (Unsplash).jpg](https://commons.wikimedia.org/wiki/File:Highway_395,_Indio,_United_States_(Unsplash).jpg) | Robson Hatsukami Morgan | CC0 1.0 |
| `stage-delivery-*` | Picked up, Out for delivery | [Great Plates food delivery in Sacramento 02.jpg](https://commons.wikimedia.org/wiki/File:Great_Plates_food_delivery_in_Sacramento_02.jpg) | US Congress | Public domain (US Congress image) |

Carrier names on containers or vessels in these photos remain trademarks of their owners. Stage photos and carrier-card
photos (`assets/carriers/`) are separate files; a carrier's own photo never stands in for a stage picture.

## Stages without a photo

Every recorded status has a photo. Only a status the tracker does not know yet keeps the drawn illustration from
`tracker/scene.js`.

## Earlier pictures (no longer used, kept on file)

`dock-*`, `aerial-*`, `dc-*`, `bays-*`, `forklift-342.*`, `campus-*`, `ship-342.*`, `air-342.*`, `dusk-*`: pictures supplied
by the site owner on 2026-10-18. They were AI-generated or 3D renders (one carried a Google Gemini mark) with rights to
be confirmed, and are no longer shown anywhere.

## 3D scenes

The interactive 3D scenes (`tracker/3d/`) are built entirely in code: geometry, materials and textures are generated
at runtime from seeded noise. They use no third-party models, textures or images. Three.js (MIT licence) is loaded
from jsDelivr. Vehicles, vessels, aircraft and buildings are generic and unbranded.
