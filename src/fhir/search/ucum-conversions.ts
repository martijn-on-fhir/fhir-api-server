/**
 * UCUM (Unified Code for Units of Measure) unit conversion table.
 * Used by quantity search to match equivalent values in different units.
 * Each unit maps to a canonical unit and a conversion factor where: value_in_unit * factor = value_in_canonical.
 */

const UCUM_SYSTEM = 'http://unitsofmeasure.org';

interface UcumUnitDef {
  /** Canonical unit code for this dimension (e.g. 'g' for mass). */
  canonical: string;
  /** Multiply stored value by this factor to get canonical value. */
  factor: number;
}

/** Conversion table: UCUM code → canonical unit + factor. Grouped by physical dimension. */
const UCUM_UNITS: Record<string, UcumUnitDef> = {
  // ── Mass ──
  'kg':  { canonical: 'g', factor: 1000 },
  'g':   { canonical: 'g', factor: 1 },
  'mg':  { canonical: 'g', factor: 0.001 },
  'ug':  { canonical: 'g', factor: 0.000001 },
  'ng':  { canonical: 'g', factor: 1e-9 },
  'pg':  { canonical: 'g', factor: 1e-12 },
  '[lb_av]': { canonical: 'g', factor: 453.59237 },
  '[oz_av]': { canonical: 'g', factor: 28.349523 },

  // ── Length ──
  'km':  { canonical: 'm', factor: 1000 },
  'm':   { canonical: 'm', factor: 1 },
  'cm':  { canonical: 'm', factor: 0.01 },
  'mm':  { canonical: 'm', factor: 0.001 },
  'um':  { canonical: 'm', factor: 0.000001 },
  'nm':  { canonical: 'm', factor: 1e-9 },
  '[in_i]': { canonical: 'm', factor: 0.0254 },
  '[ft_i]': { canonical: 'm', factor: 0.3048 },

  // ── Volume ──
  'L':   { canonical: 'L', factor: 1 },
  'dL':  { canonical: 'L', factor: 0.1 },
  'cL':  { canonical: 'L', factor: 0.01 },
  'mL':  { canonical: 'L', factor: 0.001 },
  'uL':  { canonical: 'L', factor: 0.000001 },
  'nL':  { canonical: 'L', factor: 1e-9 },
  'fL':  { canonical: 'L', factor: 1e-15 },

  // ── Time ──
  's':   { canonical: 's', factor: 1 },
  'min': { canonical: 's', factor: 60 },
  'h':   { canonical: 's', factor: 3600 },
  'd':   { canonical: 's', factor: 86400 },
  'wk':  { canonical: 's', factor: 604800 },
  'mo':  { canonical: 's', factor: 2629746 },
  'a':   { canonical: 's', factor: 31556952 },

  // ── Temperature (linear offset conversions not supported, only Celsius/Kelvin scale factor) ──
  'Cel': { canonical: 'Cel', factor: 1 },
  'K':   { canonical: 'Cel', factor: 1 },  // offset-based, factor=1 is approximate; full conversion requires offset

  // ── Amount of substance ──
  'mol':  { canonical: 'mol', factor: 1 },
  'mmol': { canonical: 'mol', factor: 0.001 },
  'umol': { canonical: 'mol', factor: 0.000001 },
  'nmol': { canonical: 'mol', factor: 1e-9 },

  // ── Concentration (amount/volume) ──
  'mol/L':  { canonical: 'mol/L', factor: 1 },
  'mmol/L': { canonical: 'mol/L', factor: 0.001 },
  'umol/L': { canonical: 'mol/L', factor: 0.000001 },
  'nmol/L': { canonical: 'mol/L', factor: 1e-9 },

  // ── Concentration (mass/volume) ──
  'g/L':   { canonical: 'g/L', factor: 1 },
  'mg/L':  { canonical: 'g/L', factor: 0.001 },
  'ug/L':  { canonical: 'g/L', factor: 0.000001 },
  'ng/L':  { canonical: 'g/L', factor: 1e-9 },
  'g/dL':  { canonical: 'g/L', factor: 10 },
  'mg/dL': { canonical: 'g/L', factor: 0.01 },
  'ug/dL': { canonical: 'g/L', factor: 0.00001 },
  'ng/dL': { canonical: 'g/L', factor: 1e-8 },
  'g/mL':  { canonical: 'g/L', factor: 1000 },
  'mg/mL': { canonical: 'g/L', factor: 1 },
  'ug/mL': { canonical: 'g/L', factor: 0.001 },
  'ng/mL': { canonical: 'g/L', factor: 0.000001 },

  // ── Pressure ──
  'Pa':      { canonical: 'Pa', factor: 1 },
  'kPa':     { canonical: 'Pa', factor: 1000 },
  'mm[Hg]':  { canonical: 'Pa', factor: 133.322 },
  'cm[H2O]': { canonical: 'Pa', factor: 98.0665 },

  // ── Energy ──
  'J':    { canonical: 'J', factor: 1 },
  'kJ':   { canonical: 'J', factor: 1000 },
  'cal':  { canonical: 'J', factor: 4.184 },
  'kcal': { canonical: 'J', factor: 4184 },

  // ── Count/Rate ──
  '10*3/uL': { canonical: '10*3/uL', factor: 1 },
  '10*6/uL': { canonical: '10*3/uL', factor: 1000 },
  '10*9/L':  { canonical: '10*3/uL', factor: 1 },
  '10*12/L': { canonical: '10*3/uL', factor: 1000 },

  // ── Percentage ──
  '%': { canonical: '%', factor: 1 },

  // ── International Units ──
  '[iU]':    { canonical: '[iU]', factor: 1 },
  '[iU]/L':  { canonical: '[iU]/L', factor: 1 },
  '[iU]/mL': { canonical: '[iU]/L', factor: 1000 },

  // ── Enzyme Units ──
  'U':    { canonical: 'U', factor: 1 },
  'U/L':  { canonical: 'U/L', factor: 1 },
  'U/mL': { canonical: 'U/L', factor: 1000 },

  // ── Mass rate ──
  'kg/m2': { canonical: 'kg/m2', factor: 1 },
};

/** Precomputed lookup: canonical unit → all UCUM codes in that dimension. */
const CANONICAL_TO_UNITS: Record<string, string[]> = {};

for (const [code, def] of Object.entries(UCUM_UNITS)) {
  if (!CANONICAL_TO_UNITS[def.canonical]) {
    CANONICAL_TO_UNITS[def.canonical] = [];
  }

  CANONICAL_TO_UNITS[def.canonical].push(code);
}

/** Result of converting a quantity to all equivalent representations. */
export interface UcumEquivalent {
  value: number;
  code: string;
}

/**
 * Converts a UCUM quantity to all equivalent representations in the same dimension.
 * Returns null if the unit is not recognized or the system is not UCUM.
 * @param value - The numeric value.
 * @param code - The UCUM unit code (e.g. 'kg', 'mg/dL').
 * @param system - The unit system URL. Only UCUM is supported.
 */
export const getUcumEquivalents = (value: number, code: string, system?: string): UcumEquivalent[] | null => {
  if (system && system !== UCUM_SYSTEM) {
    return null;
  }

  const unitDef = UCUM_UNITS[code];

  if (!unitDef) {
    return null;
  }

  const canonicalValue = value * unitDef.factor;
  const siblingCodes = CANONICAL_TO_UNITS[unitDef.canonical] || [];

  return siblingCodes.map((siblingCode) => {
    const siblingDef = UCUM_UNITS[siblingCode];

    return { value: canonicalValue / siblingDef.factor, code: siblingCode };
  });
};

/** Returns true if the given system URL is the UCUM system. */
export const isUcumSystem = (system?: string): boolean => system === UCUM_SYSTEM;

/** Returns true if the given UCUM code is known in the conversion table. */
export const isKnownUcumCode = (code: string): boolean => code in UCUM_UNITS;
