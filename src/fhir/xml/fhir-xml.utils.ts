import {XMLBuilder, XMLParser} from 'fast-xml-parser';

const FHIR_NS = 'http://hl7.org/fhir';

/** Elements that are always arrays in FHIR. */
const ARRAY_ELEMENTS = new Set([
  'name', 'telecom', 'address', 'identifier', 'coding', 'extension', 'modifierExtension', 'contained',
  'entry', 'link', 'issue', 'parameter', 'part', 'concept', 'include', 'exclude', 'filter', 'designation',
  'property', 'group', 'element', 'target', 'contact', 'communication', 'photo', 'qualification', 'given',
  'prefix', 'suffix', 'line', 'profile', 'tag', 'security', 'category', 'performer', 'component',
  'participant', 'reasonCode', 'reasonReference', 'note', 'dosageInstruction', 'reaction', 'resource',
]);

/** Escapes special XML characters. */
const escapeXml = (str: string): string => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Strips outer div tags from XHTML content. */
const stripDivTags = (html: string): string => html.replace(/^<div[^>]*>/, '').replace(/<\/div>\s*$/, '');

/** Serializes a single key-value pair to XML. */
const serializeValue = (key: string, value: any, parts: string[], depth: number): void => {
  const indent = '  '.repeat(depth);

  if (value === null || value === undefined) {
return;
}

  if (typeof value === 'object' && !Array.isArray(value)) {
    if (value.resourceType) {
      parts.push(`${indent}<${key}>`);
      parts.push(`${'  '.repeat(depth + 1)}<${value.resourceType} xmlns="${FHIR_NS}">`);
      serializeElement(value, parts, depth + 2, value.resourceType);
      parts.push(`${'  '.repeat(depth + 1)}</${value.resourceType}>`);
      parts.push(`${indent}</${key}>`);
    } else {
      parts.push(`${indent}<${key}>`);
      serializeElement(value, parts, depth + 1, key);
      parts.push(`${indent}</${key}>`);
    }
  } else {
    parts.push(`${indent}<${key} value="${escapeXml(String(value))}"/>`);
  }
};

/** Serializes a FHIR element to XML, handling primitives, objects, and arrays. */
const serializeElement = (obj: any, parts: string[], depth: number, parentName: string): void => {
  const indent = '  '.repeat(depth);

  for (const [key, value] of Object.entries(obj)) {
    if (key === 'resourceType') {
continue;
}

    if (key === 'div' && parentName === 'text') {
      parts.push(`${indent}<div xmlns="http://www.w3.org/1999/xhtml">${stripDivTags(String(value))}</div>`);
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
serializeValue(key, item, parts, depth);
}
    } else {
      serializeValue(key, value, parts, depth);
    }
  }
};

/**
 * Converts a FHIR JSON resource to FHIR XML string.
 * Follows FHIR R4 XML representation rules: primitives use value="" attributes, complex types are child elements.
 */
export const fhirJsonToXml = (resource: any): string => {
  const resourceType = resource.resourceType;

  if (!resourceType) {
throw new Error('Resource must have a resourceType');
}

  const xmlParts: string[] = [`<?xml version="1.0" encoding="UTF-8"?>`];
  xmlParts.push(`<${resourceType} xmlns="${FHIR_NS}">`);
  serializeElement(resource, xmlParts, 1, resourceType);
  xmlParts.push(`</${resourceType}>`);

  return xmlParts.join('\n');
};

/** Auto-types string values to booleans, numbers where appropriate. */
const autoType = (value: any): any => {
  if (typeof value !== 'string') {
return value;
}

  if (value === 'true') {
return true;
}

  if (value === 'false') {
return false;
}

  if (/^-?\d+$/.test(value) && value.length < 16) {
return parseInt(value, 10);
}

  if (/^-?\d+\.\d+$/.test(value) && value.length < 16) {
return parseFloat(value);
}

  return value;
};

/** Converts a parsed XML node to FHIR JSON format. */
const convertXmlToFhir = (node: any): any => {
  if (node === null || node === undefined) {
return node;
}

  if (typeof node !== 'object') {
return node;
}

  const result: any = {};

  for (const [key, value] of Object.entries(node)) {
    if (key === '@_xmlns' || key === '@_xmlns:xhtml') {
continue;
}

    if (key === '@_value') {
return autoType(value as string);
}

    if (key.startsWith('@_')) {
      result[key.substring(2)] = value;
      continue;
    }

    if (key === 'div') {
      const builder = new XMLBuilder({ignoreAttributes: false, attributeNamePrefix: '@_'});
      const inner = typeof value === 'string' ? value : builder.build({div: value}).replace(/<\/?div[^>]*>/g, '');
      result.div = `<div xmlns="http://www.w3.org/1999/xhtml">${inner}</div>`;
      continue;
    }

    if (Array.isArray(value)) {
      result[key] = value.map((item) => convertXmlToFhir(item));
    } else if (typeof value === 'object') {
      const converted = convertXmlToFhir(value);
      result[key] = ARRAY_ELEMENTS.has(key) && !Array.isArray(converted) ? [converted] : converted;
    } else {
      result[key] = autoType(value);
    }
  }

  return result;
};

/**
 * Parses a FHIR XML string to a FHIR JSON object.
 * Handles the FHIR-specific XML structure where primitives use value="" attributes.
 */
export const fhirXmlToJson = (xml: string): any => {
  const parser = new XMLParser({
    ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true,
    isArray: (name) => ARRAY_ELEMENTS.has(name),
  });
  const parsed = parser.parse(xml);

  const rootKey = Object.keys(parsed).find((k) => k !== '?xml');

  if (!rootKey) {
throw new Error('No root element found in XML');
}

  const root = parsed[rootKey];
  const result = convertXmlToFhir(root);
  result.resourceType = rootKey;

  return result;
};
