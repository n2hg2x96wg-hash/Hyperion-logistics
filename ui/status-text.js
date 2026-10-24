// Display wording for recorded shipment values, in the selected language. The values themselves are never changed:
// known status codes, standard milestone titles, exception types and event sources are mapped to translated text;
// anything typed by operations (custom titles, descriptions, notes, places) is returned exactly as recorded.
import { STATUS_META, EXCEPTION_TYPES, EVENT_SOURCES } from "../shared/status.js";
import { t, tMaybe } from "./i18n.js";

const CODE_BY_EVENT = new Map(Object.entries(STATUS_META).map(([code, m]) => [m.event, code]));
const CODE_BY_LABEL = new Map(Object.entries(STATUS_META).map(([code, m]) => [m.label, code]));
const SOURCE_BY_LABEL = new Map(Object.entries(EVENT_SOURCES).map(([k, v]) => [v, k]));

/** { code, label } from the API -> label in the selected language (stored free text stays as it is). */
export const statusText = (st) => {
  const code = st?.code || CODE_BY_LABEL.get(st?.label);
  return code ? t(`status.${code}`, null, st?.label) : st?.label || t("status.unavailable");
};
export const stepText = (code, fallback) => t(`status.short.${code}`, null, fallback);

/** A timeline / activity entry title: the standard milestone names are translated, custom titles are kept. */
export function eventTitle(e) {
  const title = String(e?.title || "");
  const code = e?.statusCode && title === STATUS_META[e.statusCode]?.event ? e.statusCode : !e?.statusCode ? CODE_BY_EVENT.get(title) : null;
  if (code) return t(`event.${code}`, null, title);
  if (title === "Location Updated") return t("event.location");
  if (title === "Update") return t("event.update");
  return title;
}

/**
 * Event description: the sentences the system writes itself are translated (see api/_lib/service.js); in server text
 * "<exception type>[: note]" the type is translated and the note kept; anything typed by operations is kept as is.
 */
export function eventDescription(e) {
  const d = String(e?.description || "");
  if (d === "Shipment registered in the Hyperion system.") return t("desc.registered");
  if (d === "Shipment location updated.") return t("desc.locationUpdated");
  const loc = d.match(/^Shipment location updated to (.+)\.$/); if (loc) return t("desc.locationUpdatedTo", { place: loc[1] });
  const st = d.match(/^Status updated to (.+)\.$/); const code = st && CODE_BY_LABEL.get(st[1]);
  if (code) return t("desc.statusUpdated", { status: t(`status.${code}`) });
  for (const [type, label] of Object.entries(EXCEPTION_TYPES)) {
    if (d === label || d.startsWith(`${label}: `)) return t(`exception.${type}`, null, label) + d.slice(label.length);
  }
  return d;
}

export const exceptionText = (ex) => tMaybe(`exception.${ex?.type}`) ?? ex?.label ?? "";
/** Source label ("GPS telemetry", "Carrier API"...) from its key or its English label. */
export const sourceLabelText = (keyOrLabel) => {
  const key = EVENT_SOURCES[keyOrLabel] ? keyOrLabel : SOURCE_BY_LABEL.get(keyOrLabel);
  return key ? t(`source.${key}`, null, EVENT_SOURCES[key]) : String(keyOrLabel || "");
};
