# Freight showcase photo

The homepage freight section (`#freight` in `index.html`) is ready for a photorealistic container-ship photo.
Until one is added it shows the original illustration `assets/hero/freight-ship.svg`, which is also the
automatic fallback if a photo ever fails to load.

**Photo to supply:** a container ship at sea or in port, landscape, at least 2400 px wide, with a calm area on the
left for the headline (blue hour or sunset suits the site). Only use a photo you are licensed to use on a commercial
website and note its source and licence in `CREDITS.md` here.

**Files generated from it** (WebP/AVIF/JPEG, metadata stripped): `ship-960|1600|2400.*` for tablets and desktops and
`ship-mobile-720|1080.*`, a crop centred on the ship for phones. They are referenced from `<source>` elements in the
section's `<picture>`.
