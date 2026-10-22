// Pictures for the public carrier cards. Carrier images and shipment-stage images are separate on purpose:
//   - carrier cards read ONLY from assets/carriers/ (this file), keyed by the carrier's stable id;
//   - the tracking result reads ONLY its own stage pictures via stagePhoto() in the tracker, keyed by the shipment's
//     recorded status and transport mode.
// Neither module imports the other. A photo is used only on the carrier it shows; a carrier without one gets a name-led
// card. Never a stage photo, never another carrier's photo, never a drawing. Every photo is public domain or CC0
// (dedicated to the public domain), so it can be used without a credit line; the source of each is kept for the record
// in `source` and in assets/carriers/SOURCES.md, and is never shown on the site.

/** Photos that belong to one carrier, by carrier id. Public domain or CC0 only: no credit line is required or shown. */
export const CARRIER_PHOTOS = Object.freeze({
  dhl: { base: "assets/carriers/dhl-express-van", widths: [480, 960], position: "50% 62%", alt: "Yellow DHL Express van parked on a street in Auckland",
    license: "CC0", source: "https://commons.wikimedia.org/wiki/File:DHL_van_in_Auckland.jpg" },
  fedex: { base: "assets/carriers/fedex-express-van", widths: [480, 960], position: "50% 58%", alt: "White FedEx Express delivery van on a city street",
    license: "CC0", source: "https://commons.wikimedia.org/wiki/File:FedEx_(49417798161).jpg" },
  ups: { base: "assets/carriers/ups-tractor-trailer", widths: [480, 960], position: "45% 62%", alt: "UPS tractor-trailer backing onto a loading dock",
    license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:UPS_semi_trailer_truck_in_Arlington_Texas.jpg" },
  usps: { base: "assets/carriers/usps-mail-van", widths: [480, 960], position: "50% 60%", alt: "White USPS mail van parked on a street",
    license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:01-04_Dodge_Caravan_USPS.jpg" },
  royalmail: { base: "assets/carriers/royal-mail-van", widths: [480, 960], position: "50% 62%", alt: "Red Royal Mail delivery van at a waterfront",
    license: "CC0", source: "https://commons.wikimedia.org/wiki/File:Royal_Mail_delivery_van_(Peugeot_Boxer)_at_Chatham_Waterfront,_Kent,_England.jpg" },
  canadapost: { base: "assets/carriers/canada-post-transit-van", widths: [480, 960], position: "50% 55%", alt: "White Canada Post delivery van on a street in Toronto",
    license: "CC0", source: "https://commons.wikimedia.org/wiki/File:CanadaPostVanCropped.jpg" },
  auspost: { base: "assets/carriers/australia-post-transit-van", widths: [480, 960], position: "50% 55%", alt: "Red Australia Post delivery van",
    license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:2000-2004_Ford_Transit_(VH)_low_roof_SWB_van_(Australia_Post)_01.jpg" },
  japanpost: { base: "assets/carriers/japan-post-minicab-ev", widths: [480, 960], position: "50% 62%", alt: "Red Japan Post electric delivery van",
    license: "CC0", source: "https://commons.wikimedia.org/wiki/File:Japan_Post_Mitsubishi_Minicab_EV_U69V.jpg" },
  sfexpress: { base: "assets/carriers/sf-express-truck", widths: [480, 960], position: "50% 55%", alt: "Black SF Express delivery truck on a street",
    license: "CC0", source: "https://commons.wikimedia.org/wiki/File:SF_Express_Taiwan_561-ZP_20191210a.jpg" },
  msc: { base: "assets/carriers/msc-astrid-container-ship", widths: [480, 960], position: "50% 55%", alt: "MSC container ship under way with tugs alongside",
    license: "CC0", source: "https://commons.wikimedia.org/wiki/File:MSC_ASTRID_Container_Ship._(34201586040).jpg" },
  emiratesskycargo: { base: "assets/carriers/emirates-777f-heathrow", widths: [480, 960], position: "50% 50%", alt: "Emirates SkyCargo Boeing 777 freighter landing at Heathrow",
    license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Emirates_Boeing_777F_(A6-EFM)_arrives_London_Heathrow_11Apr2015_arp.jpg" },
  ethiopiancargo: { base: "assets/carriers/ethiopian-cargo-777f", widths: [480, 960], position: "50% 45%", alt: "Ethiopian Cargo Boeing 777 freighter climbing after take-off",
    license: "CC0", source: "https://commons.wikimedia.org/wiki/File:ET-BAA_(20_Mar_2025).jpg" },
  qatarcargo: { base: "assets/carriers/qatar-cargo-777f-schiphol", widths: [480, 960], position: "50% 52%", alt: "Qatar Airways Cargo Boeing 777 freighter taxiing at Schiphol",
    license: "CC0", source: "https://commons.wikimedia.org/wiki/File:A7-BFC_Qatar_Airways_Cargo_Boeing_777-FDZ_-_cn_36099,_taxiing_21july2013_pic-006.JPG" },
  lufthansacargo: { base: "assets/carriers/lufthansa-cargo-777f-d-alfi", widths: [480, 960], position: "50% 58%", alt: "Lufthansa Cargo Boeing 777 freighter on the taxiway",
    license: "CC0", source: "https://commons.wikimedia.org/wiki/File:Lufthansa_Cargo_Boeing_777F_D-ALFI.jpg" },
  maersk: { base: "assets/carriers/laust-maersk-container-ship", widths: [480, 960], position: "50% 55%", alt: "Blue Maersk Line container ship under way",
    license: "CC0", source: "https://commons.wikimedia.org/wiki/File:LAUST_MAERSK._Container_ship._-_Flickr_-_Bernard_Spragg.jpg" },
  cmacgm: { base: "assets/carriers/cma-cgm-tage-container-ship", widths: [480, 960], position: "50% 50%", alt: "Fully loaded CMA CGM container ship seen from above",
    license: "CC0", source: "https://commons.wikimedia.org/wiki/File:CMA_CGM_TAGE.Container_ship._(24538247898).jpg" },
  correios: { base: "assets/carriers/sedex-truck", widths: [480, 960], position: "50% 55%", alt: "Yellow Correios SEDEX delivery truck",
    license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Mercedes-Benz_do_SEDEX_do_Brasil.jpg" },
  "tesla-transport": { base: "assets/carriers/tesla-semi-silver", widths: [480, 960], position: "50% 60%", alt: "Silver Tesla Semi electric truck with a trailer",
    license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Tesla_Semi_3.jpg" },
  ems: { base: "assets/carriers/ems-china-post-counter", widths: [480, 960], position: "60% 70%", alt: "EMS express mail counter at a post office",
    license: "CC0", source: "https://commons.wikimedia.org/wiki/File:SZ_深圳市_Shenzhen_福田口岸站_Futian_Checkpoint_Metro_Station_concourse_shop_中國郵政_China_Post_Office_国际快递_EMS_Worldwide_courier_services_December_2023_R12S_01.jpg" },
});

export const CARD_CATEGORIES = Object.freeze(["express", "air", "ocean", "regional", "custom"]);

/**
 * What a carrier card shows: { type: "photo", base, widths, position, alt } for a carrier with its own photo, otherwise
 * { type: "name", category } (name-led card). Looked up by id only, so list order, filters and display names can never
 * move a picture onto another carrier.
 */
export function carrierMedia(c) {
  const photo = Object.hasOwn(CARRIER_PHOTOS, c?.id) ? CARRIER_PHOTOS[c.id] : null;
  if (photo) return { type: "photo", ...photo };
  return { type: "name", category: CARD_CATEGORIES.includes(c?.category) ? c.category : "custom" };
}
