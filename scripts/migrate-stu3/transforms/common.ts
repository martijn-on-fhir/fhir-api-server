/** Common STU3 → R4 transforms applied to all resources. */

const PROFILE_REWRITES: [RegExp, string][] = [
  [/^http:\/\/fhir\.nl\/fhir\/StructureDefinition\//, 'http://nictiz.nl/fhir/StructureDefinition/'],
];

const EXTENSION_URL_REWRITES: [RegExp, string][] = [
  [/^http:\/\/fhir\.nl\/fhir\/StructureDefinition\//, 'http://nictiz.nl/fhir/StructureDefinition/'],
];

/** Rewrite profile URLs from STU3 nl-core to R4 nl-core. */
export const rewriteProfiles = (profiles: string[] | undefined): string[] | undefined => {

  if (!profiles || profiles.length === 0) {
    return profiles;
  }

  return profiles.map(url => {
    for (const [pattern, replacement] of PROFILE_REWRITES) {
      if (pattern.test(url)) {
        return url.replace(pattern, replacement);
      }
    }

    return url;
  });
}

/** Reset meta to R4 defaults: versionId '1', fresh lastUpdated, rewritten profiles. */
export const upgradeMeta = (resource: any): void => {
  const meta = resource.meta || {};
  meta.versionId = '1';
  meta.lastUpdated = new Date().toISOString();
  meta.profile = rewriteProfiles(meta.profile);
  resource.meta = meta;
}

/** Recursively rewrite extension URLs throughout a resource. */
export const rewriteExtensionUrls = (obj: any): void => {

  if (obj == null || typeof obj !== 'object') {
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach(item => rewriteExtensionUrls(item));

    return;
  }

  if (obj.url && typeof obj.url === 'string') {
    for (const [pattern, replacement] of EXTENSION_URL_REWRITES) {
      if (pattern.test(obj.url)) {
        obj.url = obj.url.replace(pattern, replacement);
        break;
      }
    }
  }

  if (obj.extension) {
    rewriteExtensionUrls(obj.extension);
  }

  if (obj.modifierExtension) {
    rewriteExtensionUrls(obj.modifierExtension);
  }

  for (const key of Object.keys(obj)) {
    if (key !== 'url' && typeof obj[key] === 'object') {
      rewriteExtensionUrls(obj[key]);
    }
  }
}

/** Apply all common transforms to a resource (mutates in place). */
export const applyCommonTransforms = (resource: any): void => {

  upgradeMeta(resource);
  rewriteExtensionUrls(resource);
  // Remove MongoDB _id if present
  delete resource._id;
  delete resource.__v;
}
