/**
 * Seed script for load testing. Run with Node.js before starting k6.
 * Usage: node test/load/seed-data.js [baseUrl]
 *
 * Creates 100 patients, 10 practitioners, 5 organizations, and 1000 observations.
 * Writes created resource IDs to test/load/.seed-ids.json for use by k6 scenarios.
 */

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const FHIR_URL = `${BASE_URL}/fhir`;

const HEADERS = {'Content-Type': 'application/fhir+json', 'Accept': 'application/fhir+json'};

const GIVEN_NAMES = ['Jan', 'Piet', 'Klaas', 'Maria', 'Anna', 'Sophie', 'Dirk', 'Emma', 'Lars', 'Eva', 'Thomas', 'Lisa', 'Bram', 'Julia', 'Daan', 'Sara', 'Luc', 'Femke', 'Sander', 'Inge'];
const FAMILY_NAMES = ['de Vries', 'Jansen', 'van den Berg', 'Bakker', 'Visser', 'Smit', 'Meijer', 'de Boer', 'Mulder', 'de Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'van Dijk', 'Brouwer', 'de Wit', 'Dijkstra', 'Smeets', 'van der Linden'];
const OBSERVATION_CODES = [
  {system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel'},
  {system: 'http://loinc.org', code: '2339-0', display: 'Glucose [Mass/volume] in Blood'},
  {system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin [Mass/volume] in Blood'},
  {system: 'http://loinc.org', code: '2093-3', display: 'Cholesterol [Mass/volume] in Serum or Plasma'},
  {system: 'http://loinc.org', code: '8867-4', display: 'Heart rate'},
  {system: 'http://loinc.org', code: '8310-5', display: 'Body temperature'},
  {system: 'http://loinc.org', code: '29463-7', display: 'Body weight'},
  {system: 'http://loinc.org', code: '8302-2', display: 'Body height'},
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomDate = (yearFrom, yearTo) => {
  const start = new Date(yearFrom, 0, 1).getTime();
  const end = new Date(yearTo, 11, 31).getTime();
  return new Date(start + Math.random() * (end - start)).toISOString().split('T')[0];
};

async function post(resourceType, body) {
  const res = await fetch(`${FHIR_URL}/${resourceType}`, {method: 'POST', headers: HEADERS, body: JSON.stringify(body)});
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${resourceType} failed: ${res.status} ${text.substring(0, 200)}`);
  }
  return res.json();
}

async function seed() {
  console.log(`Seeding data to ${FHIR_URL}...`);
  const ids = {patients: [], practitioners: [], organizations: [], observations: [], encounters: [], conditions: []};

  // Organizations
  console.log('Creating 5 organizations...');
  for (let i = 0; i < 5; i++) {
    const org = await post('Organization', {
      resourceType: 'Organization', name: `Ziekenhuis ${i + 1}`, active: true,
      identifier: [{system: 'http://fhir.nl/fhir/NamingSystem/agb', value: `${10000000 + i}`}],
      type: [{coding: [{system: 'http://terminology.hl7.org/CodeSystem/organization-type', code: 'prov', display: 'Healthcare Provider'}]}],
    });
    ids.organizations.push(org.id);
  }

  // Practitioners
  console.log('Creating 10 practitioners...');
  for (let i = 0; i < 10; i++) {
    const prac = await post('Practitioner', {
      resourceType: 'Practitioner', active: true,
      name: [{family: pick(FAMILY_NAMES), given: [pick(GIVEN_NAMES)], prefix: ['Dr.']}],
      identifier: [{system: 'http://fhir.nl/fhir/NamingSystem/big', value: `${90000000 + i}`}],
    });
    ids.practitioners.push(prac.id);
  }

  // Patients
  console.log('Creating 100 patients...');
  for (let i = 0; i < 100; i++) {
    const patient = await post('Patient', {
      resourceType: 'Patient', active: true,
      name: [{family: pick(FAMILY_NAMES), given: [pick(GIVEN_NAMES)]}],
      gender: Math.random() > 0.5 ? 'male' : 'female',
      birthDate: randomDate(1940, 2010),
      identifier: [{system: 'http://fhir.nl/fhir/NamingSystem/bsn', value: `${100000000 + i}`}],
      managingOrganization: {reference: `Organization/${pick(ids.organizations)}`},
    });
    ids.patients.push(patient.id);
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/100 patients`);
  }

  // Encounters
  console.log('Creating 200 encounters...');
  for (let i = 0; i < 200; i++) {
    const enc = await post('Encounter', {
      resourceType: 'Encounter', status: pick(['finished', 'in-progress', 'planned']),
      class: {system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: pick(['AMB', 'IMP', 'EMER']), display: 'ambulatory'},
      subject: {reference: `Patient/${pick(ids.patients)}`},
      participant: [{individual: {reference: `Practitioner/${pick(ids.practitioners)}`}}],
      period: {start: randomDate(2023, 2025)},
      serviceProvider: {reference: `Organization/${pick(ids.organizations)}`},
    });
    ids.encounters.push(enc.id);
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/200 encounters`);
  }

  // Observations
  console.log('Creating 1000 observations...');
  for (let i = 0; i < 1000; i++) {
    const code = pick(OBSERVATION_CODES);
    const obs = await post('Observation', {
      resourceType: 'Observation', status: 'final',
      code: {coding: [code], text: code.display},
      subject: {reference: `Patient/${pick(ids.patients)}`},
      encounter: {reference: `Encounter/${pick(ids.encounters)}`},
      performer: [{reference: `Practitioner/${pick(ids.practitioners)}`}],
      effectiveDateTime: `${randomDate(2023, 2025)}T${String(Math.floor(Math.random() * 24)).padStart(2, '0')}:00:00Z`,
      valueQuantity: {value: Math.round(Math.random() * 200 * 10) / 10, unit: 'mg/dL', system: 'http://unitsofmeasure.org', code: 'mg/dL'},
    });
    ids.observations.push(obs.id);
    if ((i + 1) % 200 === 0) console.log(`  ${i + 1}/1000 observations`);
  }

  // Conditions
  console.log('Creating 200 conditions...');
  const conditionCodes = [
    {system: 'http://snomed.info/sct', code: '73211009', display: 'Diabetes mellitus'},
    {system: 'http://snomed.info/sct', code: '38341003', display: 'Hypertensive disorder'},
    {system: 'http://snomed.info/sct', code: '195967001', display: 'Asthma'},
    {system: 'http://snomed.info/sct', code: '44054006', display: 'Diabetes mellitus type 2'},
    {system: 'http://snomed.info/sct', code: '13645005', display: 'Chronic obstructive lung disease'},
  ];
  for (let i = 0; i < 200; i++) {
    const code = pick(conditionCodes);
    const cond = await post('Condition', {
      resourceType: 'Condition', clinicalStatus: {coding: [{system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active'}]},
      verificationStatus: {coding: [{system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed'}]},
      code: {coding: [code], text: code.display},
      subject: {reference: `Patient/${pick(ids.patients)}`},
      encounter: {reference: `Encounter/${pick(ids.encounters)}`},
      onsetDateTime: randomDate(2020, 2025),
    });
    ids.conditions.push(cond.id);
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/200 conditions`);
  }

  // Write IDs to file for k6
  const fs = await import('fs');
  const path = await import('path');
  const outPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '.seed-ids.json');
  fs.writeFileSync(outPath, JSON.stringify(ids, null, 2));
  console.log(`\nSeed complete! IDs written to ${outPath}`);
  console.log(`  ${ids.patients.length} patients, ${ids.practitioners.length} practitioners, ${ids.organizations.length} organizations`);
  console.log(`  ${ids.encounters.length} encounters, ${ids.observations.length} observations, ${ids.conditions.length} conditions`);
  console.log(`  Total: ${Object.values(ids).reduce((sum, arr) => sum + arr.length, 0)} resources`);
}

seed().catch((err) => { console.error(err); process.exit(1); });
