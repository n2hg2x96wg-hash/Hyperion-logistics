// Pictures for the public carrier cards. Carrier images and shipment-stage images are separate on purpose:
//   - carrier cards read ONLY from assets/carriers/ (this file), keyed by the carrier's stable id;
//   - the tracking result reads ONLY its own stage pictures via stagePhoto() in the tracker, keyed by the shipment's
//     recorded status and transport mode.
// Neither module imports the other. A photo is used only on the carrier it shows. A carrier without its own photo gets a
// name-led card (its name as the visual, in its brand colour): never a stock or stage photo, never another carrier's
// photo, never a drawing standing in for a picture. Every photo is openly licensed on Wikimedia Commons and credited on the card;
// sources, authors and licences: assets/carriers/ATTRIBUTION.md.

/** Photos that belong to one carrier, by carrier id, with the credit their licence requires (assets/carriers/ATTRIBUTION.md). */
export const CARRIER_PHOTOS = Object.freeze({
  dhl: { base: "assets/carriers/dhl", widths: [480, 960], position: "50% 60%", alt: "DHL electric Ford E-Transit delivery van",
    credit: { author: "Joost J. Bakker", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0", source: "https://commons.wikimedia.org/wiki/File:2023_Ford_Transit_DHL_(54149980302).jpg" } },
  fedex: { base: "assets/carriers/fedex", widths: [480, 960], position: "55% 60%", alt: "FedEx Express box truck on a city street",
    credit: { author: "Tomás Del Coro from Las Vegas, Nevada, USA", license: "CC BY-SA 2.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0", source: "https://commons.wikimedia.org/wiki/File:FEDEX_(5106512117).jpg" } },
  ups: { base: "assets/carriers/ups", widths: [480, 960], position: "45% 60%", alt: "UPS package truck with Worldwide Services livery",
    credit: { author: "Yonikasz", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:UPS_Truck_Woodfield_Mall.jpg" } },
  usps: { base: "assets/carriers/usps", widths: [480, 960], position: "50% 55%", alt: "USPS mail truck with \"We Deliver For You\" livery",
    credit: { author: "Famartin", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:2022-07-23_14_57_13_United_States_Postal_Service_mail_truck_at_The_Osprey%27s_at_Belmont_Bay_in_Woodbridge,_Prince_William_County,_Virginia.jpg" } },
  royalmail: { base: "assets/carriers/royalmail", widths: [480, 960], position: "55% 60%", alt: "A row of Royal Mail delivery vans",
    credit: { author: "Russel Wills", license: "CC BY-SA 2.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0", source: "https://commons.wikimedia.org/wiki/File:A_c%C3%A8ilidh_of_Royal_Mail_vans_on_the_pier_-_geograph.org.uk_-_6189868.jpg" } },
  canadapost: { base: "assets/carriers/canadapost", widths: [480, 960], position: "45% 60%", alt: "Canada Post delivery step van",
    credit: { author: "Dillan Payne", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Canada_Post_Van_63695_on_Coxwell_Avenue,_August_6_2026.jpg" } },
  auspost: { base: "assets/carriers/auspost", widths: [480, 960], position: "50% 55%", alt: "Australia Post Mercedes-Benz Sprinter delivery van",
    credit: { author: "Orderinchaos", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", source: "https://commons.wikimedia.org/wiki/File:Aus_Post_Mercedes-Benz_Sprinter_311_CDI_Perth.jpg" } },
  japanpost: { base: "assets/carriers/japanpost", widths: [480, 960], position: "50% 60%", alt: "Japan Post red delivery van",
    credit: { author: "CEphoto, Uwe Aranas", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", source: "https://commons.wikimedia.org/wiki/File:Nakijin_Okinawa_Japan_Post-Van-01.jpg" } },
  sfexpress: { base: "assets/carriers/sfexpress", widths: [480, 960], position: "50% 55%", alt: "SF Express delivery van",
    credit: { author: "LN9267", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:XF5215(SF_Express)_12-02-2022.jpg" } },
  msc: { base: "assets/carriers/msc", widths: [480, 960], position: "45% 55%", alt: "MSC container ship at sea",
    credit: { author: "Alexandro Dias", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Navio_m_s_c_de_carga.jpg" } },
  aramex: { base: "assets/carriers/aramex", widths: [480, 960], position: "55% 60%", alt: "Aramex warehouse and sign in Milnerton, Cape Town",
    credit: { author: "Husskeyy", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Aramex_Warehouse_in_Milnerton,_Cape_Town.jpg" } },
  "2goexpress": { base: "assets/carriers/2goexpress", widths: [480, 960], position: "50% 50%", alt: "2GO Express store counter",
    credit: { author: "Iloilo Wanderer", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", source: "https://commons.wikimedia.org/wiki/File:2GO_Express_store_in_a_mall.jpg" } },
  giglogistics: { base: "assets/carriers/giglogistics", widths: [480, 960], position: "50% 45%", alt: "GIG Logistics building in Gbagada, Lagos",
    credit: { author: "S.aderogba", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Gig-logistics-gbagada-lagos.jpg" } },
  emiratesskycargo: { base: "assets/carriers/emiratesskycargo", widths: [480, 960], position: "50% 55%", alt: "Emirates SkyCargo Boeing 777 freighter on the runway",
    credit: { author: "dxme from Schweiz", license: "CC BY-SA 2.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0", source: "https://commons.wikimedia.org/wiki/File:Emirates_SkyCargo_Boeing_777F_-_A6-EFH_-_BSL_(22609584013).jpg" } },
  ethiopiancargo: { base: "assets/carriers/ethiopiancargo", widths: [480, 960], position: "45% 50%", alt: "Ethiopian Cargo Boeing 777 freighter in flight",
    credit: { author: "Md Shaifuzzaman Ayon", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Ethiopian_Cargo_Airlines_(ET-AVN)_Boeing_777-F60_VGHS.jpg" } },
  qatarcargo: { base: "assets/carriers/qatarcargo", widths: [480, 960], position: "50% 55%", alt: "Qatar Airways Cargo Boeing 777 freighter",
    credit: { author: "MarcelX42", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Li%C3%A8ge_Airport_Qatar_Airways_Cargo_Boeing_777-F_A7-BFX_(DSC06485).jpg" } },
  lufthansacargo: { base: "assets/carriers/lufthansacargo", widths: [480, 960], position: "50% 50%", alt: "Lufthansa Cargo Boeing 777 freighter taking off",
    credit: { author: "tjdarmstadt", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0", source: "https://commons.wikimedia.org/wiki/File:Lufthansa_Cargo_Boeing_777F_(D-ALFA)_at_Frankfurt_Airport.jpg" } },
  maersk: { base: "assets/carriers/maersk", widths: [480, 960], position: "50% 55%", alt: "Maersk container ship at a container terminal",
    credit: { author: "Petar Milošević", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:MAERSK_HANOI_Container_Ship_(Port_Koper_SIKOP,_2023).jpg" } },
  cmacgm: { base: "assets/carriers/cmacgm", widths: [480, 960], position: "55% 60%", alt: "CMA CGM container ship at the Burchardkai terminal, Hamburg",
    credit: { author: "Matti Blume", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:CMA_CGM_Kerguelen,_Container_Terminal_Burchardkai,_Hamburg_(P1080471).jpg" } },
  correios: { base: "assets/carriers/correios", widths: [480, 960], position: "50% 60%", alt: "Correios SEDEX Peugeot Expert delivery van",
    credit: { author: "Mateusmatsuda", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0", source: "https://commons.wikimedia.org/wiki/File:Correios_SEDEX_Peugeot_Expert.jpg" } },
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
