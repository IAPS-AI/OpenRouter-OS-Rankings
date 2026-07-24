// Shared helpers for the data pipeline.

// Permaslug -> base model: strip the ":variant" suffix (":free", ":beta",
// ":extended", ...) and a trailing "-YYYYMMDD" snapshot date.
export const normalize = (slug) => slug.split(':')[0].replace(/-20\d{6}$/, '');
