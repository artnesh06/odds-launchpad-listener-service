/**
 * Attribute Normalizer
 * Normalizes NFT attributes while preserving original formatting
 */

export interface RawAttribute {
  trait_type?: string;
  traitType?: string;
  value: any;
  display_type?: string;
  displayType?: string;
}

export interface NormalizedAttribute {
  traitType: string;
  value: string;
  displayType?: string;
  numericValue?: number;
  originalTraitType: string;
  originalValue: any;
}

/**
 * Normalize trait type to consistent format
 */
export function normalizeTraitType(traitType: string): string {
  return traitType
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '_') // Replace spaces and multiple underscores with single underscore
    .replace(/[^a-z0-9_]/g, ''); // Remove special characters
}

/**
 * Normalize attribute value to string
 */
export function normalizeValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value).trim();
}

/**
 * Extract numeric value from attribute if applicable
 */
export function extractNumericValue(
  value: any,
  displayType?: string
): number | undefined {
  // If display type indicates numeric, try to parse
  if (
    displayType &&
    ['number', 'boost_number', 'boost_percentage'].includes(displayType)
  ) {
    const num = parseFloat(String(value));
    return isNaN(num) ? undefined : num;
  }

  // Try to parse as number if value looks numeric
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    // Remove common non-numeric characters
    const cleaned = value.replace(/[,%$]/g, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? undefined : num;
  }

  return undefined;
}

/**
 * Normalize display type
 */
export function normalizeDisplayType(displayType?: string): string | undefined {
  if (!displayType) {
    return undefined;
  }

  const normalized = displayType.toLowerCase().trim();

  // Map common variations to standard types
  const typeMap: Record<string, string> = {
    number: 'number',
    numeric: 'number',
    int: 'number',
    integer: 'number',
    float: 'number',
    decimal: 'number',
    date: 'date',
    datetime: 'date',
    timestamp: 'date',
    boost_number: 'boost_number',
    boost: 'boost_number',
    boost_percentage: 'boost_percentage',
    percentage: 'boost_percentage',
    percent: 'boost_percentage',
  };

  return typeMap[normalized] || normalized;
}

/**
 * Normalize a single attribute
 */
export function normalizeAttribute(
  rawAttribute: RawAttribute
): NormalizedAttribute {
  // Extract trait type (handle both snake_case and camelCase)
  const traitType =
    rawAttribute.trait_type || rawAttribute.traitType || 'unknown';
  const originalTraitType = traitType;
  const normalizedTraitType = normalizeTraitType(traitType);

  // Extract and normalize value
  const originalValue = rawAttribute.value;
  const normalizedValue = normalizeValue(originalValue);

  // Extract and normalize display type
  const displayType =
    rawAttribute.display_type || rawAttribute.displayType || undefined;
  const normalizedDisplayType = normalizeDisplayType(displayType);

  // Extract numeric value if applicable
  const numericValue = extractNumericValue(originalValue, normalizedDisplayType);

  return {
    traitType: normalizedTraitType,
    value: normalizedValue,
    displayType: normalizedDisplayType,
    numericValue,
    originalTraitType,
    originalValue,
  };
}

/**
 * Normalize array of attributes
 */
export function normalizeAttributes(
  rawAttributes: RawAttribute[]
): NormalizedAttribute[] {
  return rawAttributes
    .filter((attr) => attr.value !== null && attr.value !== undefined)
    .map((attr) => normalizeAttribute(attr));
}

/**
 * Validate attribute structure
 */
export function validateAttribute(attribute: any): boolean {
  if (!attribute || typeof attribute !== 'object') {
    return false;
  }

  // Must have either trait_type or traitType
  const hasTraitType = 'trait_type' in attribute || 'traitType' in attribute;
  if (!hasTraitType) {
    return false;
  }

  // Must have value
  if (!('value' in attribute)) {
    return false;
  }

  return true;
}

/**
 * Filter and validate attributes
 */
export function filterValidAttributes(attributes: any[]): RawAttribute[] {
  if (!Array.isArray(attributes)) {
    return [];
  }

  return attributes.filter((attr) => validateAttribute(attr));
}

/**
 * Group attributes by trait type
 */
export function groupAttributesByTraitType(
  attributes: NormalizedAttribute[]
): Map<string, NormalizedAttribute[]> {
  const grouped = new Map<string, NormalizedAttribute[]>();

  for (const attr of attributes) {
    const existing = grouped.get(attr.traitType) || [];
    existing.push(attr);
    grouped.set(attr.traitType, existing);
  }

  return grouped;
}

/**
 * Get unique trait types
 */
export function getUniqueTraitTypes(
  attributes: NormalizedAttribute[]
): string[] {
  const types = new Set<string>();
  for (const attr of attributes) {
    types.add(attr.traitType);
  }
  return Array.from(types);
}

/**
 * Check if attribute is numeric
 */
export function isNumericAttribute(attribute: NormalizedAttribute): boolean {
  return attribute.numericValue !== undefined;
}

/**
 * Get numeric attributes only
 */
export function getNumericAttributes(
  attributes: NormalizedAttribute[]
): NormalizedAttribute[] {
  return attributes.filter((attr) => isNumericAttribute(attr));
}

/**
 * Format attribute for display (preserves original formatting)
 */
export function formatAttributeForDisplay(attribute: NormalizedAttribute): {
  traitType: string;
  value: string;
  displayType?: string;
} {
  return {
    traitType: attribute.originalTraitType,
    value: String(attribute.originalValue),
    displayType: attribute.displayType,
  };
}

/**
 * Format attributes for storage (normalized)
 */
export function formatAttributeForStorage(attribute: NormalizedAttribute): {
  traitType: string;
  value: string;
  displayType?: string;
  numericValue?: number;
} {
  return {
    traitType: attribute.traitType,
    value: attribute.value,
    displayType: attribute.displayType,
    numericValue: attribute.numericValue,
  };
}
