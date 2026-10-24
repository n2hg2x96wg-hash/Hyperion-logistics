# Interface translations

One file per language: `<code>.js` exporting a flat object (`"key": "text"`). `en.js` is the source and the fallback:
a key missing from a language shows its English text, never an error. `ui/i18n.js` loads a language only when a
visitor picks it. Check every file with `node --test test/i18n.test.js`.

| Code | Language | Notes |
| --- | --- | --- |
| `en` | English | Source text. Default when no language was chosen. |
| `pt-PT` | Portuguese (Portugal) | European Portuguese vocabulary and grammar (e.g. *registo*, *ecrã*, *camião*, *a carregar…*). Separate from `pt-BR`. |
| `pt-BR` | Portuguese (Brazil) | Brazilian vocabulary and grammar (e.g. *registro*, *tela*, *caminhão*, *carregando…*). |
| `ro` | Romanian | Formal address (*dumneavoastră*, imperative *-ți*), correct diacritics ș ț ă â î (comma below). |
| `es` | Spanish | Neutral international Spanish, formal *usted*, no region-only words. |
| `fr` | French | France French, *vous*; non-breaking space before `: ; ? !`. |
| `de` | German | *Sie*. |
| `it` | Italian | Standard Italian as used on Italian courier sites. |
| `nl` | Dutch | *je/jouw*, as used on Dutch courier sites. |
| `ar` | Arabic | Modern Standard Arabic; the page switches to right-to-left. |
| `zh-CN` | Chinese (Simplified) | Mainland usage, simplified characters. |
| `pcm` | Nigerian Pidgin | Natural, respectful Naijá, written the way Nigerians read it. Not a word-for-word swap. |

## Rules

- **Keep every key** of `en.js`, with the same `{placeholders}` (never translate the word inside braces) and the same
  inline tags (`<span>`, `<strong>`; nothing else is allowed and no attributes).
- **Plurals:** keys ending in `.one` / `.other` are plural forms. Give every plural category the language uses
  (`Intl.PluralRules(code).resolvedOptions().pluralCategories`). Arabic: `zero one two few many other`; Romanian:
  `one few other`; Chinese: `other` only.
- **Never translate:** Hyperion Logistics, carrier and company names (DHL, Maersk, Emirates SkyCargo…), GPS, 3D, km,
  e-mail addresses, tracking codes. City names in the data stay as written.
- **Meaning first.** The site is careful about what it claims: *recorded* is not *live*, an *estimate* is not a
  *guarantee*, an illustration is not a photo of the shipment. Keep these distinctions; never add promises.
- **Statuses are display text only.** The stored values (`IN_TRANSIT`…) never change; these strings only label them.
- **One term per concept** within a language: use the same word for shipment, parcel, tracking number, in transit,
  out for delivery, delivered, delayed, customs, carrier, milestone, recorded, estimated delivery, customer support.
  Each file starts with a short glossary comment listing the terms it uses.
- Flag anything uncertain in a `// REVIEW:` comment next to the key rather than guessing a different meaning.

## Adding a language

Add it to `LANGUAGES` in `ui/i18n.js`, to the pattern in the small `hx-lang` script in the `<head>` of each public
page, and create `<code>.js` here. The test lists every key that is still missing.
