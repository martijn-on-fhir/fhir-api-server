import http from 'k6/http';
import {check} from 'k6';
import {SharedArray} from 'k6/data';
import {FHIR_URL, FHIR_HEADERS, SEARCH_THRESHOLDS} from '../config.js';

const seedIds = new SharedArray('seedIds', () => [JSON.parse(open('../.seed-ids.json'))]);
const ids = seedIds[0];

export const options = {
  scenarios: {
    search_queries: {
      executor: 'ramping-rate',
      startRate: 5,
      stages: [
        {target: 50, duration: '15s'},
        {target: 100, duration: '30s'},
        {target: 200, duration: '30s'},
        {target: 200, duration: '30s'},
        {target: 0, duration: '15s'},
      ],
      preAllocatedVUs: 30,
      maxVUs: 100,
    },
  },
  thresholds: SEARCH_THRESHOLDS,
};

const SEARCHES = [
  // Patient search by name (string search)
  () => `${FHIR_URL}/Patient?name=Jan&_count=20`,
  // Patient search by identifier (token search)
  () => `${FHIR_URL}/Patient?identifier=http://fhir.nl/fhir/NamingSystem/bsn|100000050`,
  // Observation search by patient + code (reference + token)
  () => {
    const patientId = ids.patients[Math.floor(Math.random() * ids.patients.length)];
    return `${FHIR_URL}/Observation?patient=Patient/${patientId}&code=http://loinc.org|85354-9&_sort=-date&_count=10`;
  },
  // Observation search by date range
  () => `${FHIR_URL}/Observation?date=ge2024-01-01&date=le2024-12-31&_count=50`,
  // Encounter search by patient
  () => {
    const patientId = ids.patients[Math.floor(Math.random() * ids.patients.length)];
    return `${FHIR_URL}/Encounter?patient=Patient/${patientId}&_count=20`;
  },
  // Condition search with _include
  () => {
    const patientId = ids.patients[Math.floor(Math.random() * ids.patients.length)];
    return `${FHIR_URL}/Condition?patient=Patient/${patientId}&_include=Condition:subject`;
  },
  // Observation search with _revinclude (heavier)
  () => `${FHIR_URL}/Patient?name=de&_revinclude=Observation:subject&_count=5`,
  // Global _lastUpdated search
  () => `${FHIR_URL}/Observation?_sort=-_lastUpdated&_count=20`,
];

export default function () {
  const buildUrl = SEARCHES[Math.floor(Math.random() * SEARCHES.length)];
  const url = buildUrl();
  const res = http.get(url, {headers: FHIR_HEADERS});

  check(res, {
    'status is 200': (r) => r.status === 200,
    'is Bundle': (r) => r.json('resourceType') === 'Bundle',
    'has total': (r) => r.json('total') !== undefined,
  });
}
