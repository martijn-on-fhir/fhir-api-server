import http from 'k6/http';
import {check} from 'k6';
import {SharedArray} from 'k6/data';
import {FHIR_URL, FHIR_HEADERS, DEFAULT_THRESHOLDS} from '../config.js';

const seedIds = new SharedArray('seedIds', () => [JSON.parse(open('../.seed-ids.json'))]);
const ids = seedIds[0];

export const options = {
  scenarios: {
    crud_mix: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        {target: 20, duration: '15s'},
        {target: 50, duration: '30s'},
        {target: 50, duration: '60s'},
        {target: 0, duration: '15s'},
      ],
    },
  },
  thresholds: DEFAULT_THRESHOLDS,
};

const GIVEN = ['Jan', 'Piet', 'Maria', 'Anna', 'Dirk', 'Eva', 'Lars', 'Sophie'];
const FAMILY = ['de Vries', 'Jansen', 'Bakker', 'Visser', 'Smit', 'Meijer'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export default function () {
  const roll = Math.random();

  if (roll < 0.5) {
    // 50% — Read
    const patientId = pick(ids.patients);
    const res = http.get(`${FHIR_URL}/Patient/${patientId}`, {headers: FHIR_HEADERS});
    check(res, {'read 200': (r) => r.status === 200});

  } else if (roll < 0.7) {
    // 20% — Search
    const res = http.get(`${FHIR_URL}/Observation?_sort=-_lastUpdated&_count=10`, {headers: FHIR_HEADERS});
    check(res, {'search 200': (r) => r.status === 200});

  } else if (roll < 0.85) {
    // 15% — Create Observation
    const code = {system: 'http://loinc.org', code: '8867-4', display: 'Heart rate'};
    const body = JSON.stringify({
      resourceType: 'Observation', status: 'final',
      code: {coding: [code], text: code.display},
      subject: {reference: `Patient/${pick(ids.patients)}`},
      effectiveDateTime: new Date().toISOString(),
      valueQuantity: {value: Math.round(60 + Math.random() * 40), unit: '/min', system: 'http://unitsofmeasure.org', code: '/min'},
    });
    const res = http.post(`${FHIR_URL}/Observation`, body, {headers: FHIR_HEADERS});
    check(res, {'create 201': (r) => r.status === 201});

  } else if (roll < 0.95) {
    // 10% — Update Patient
    const patientId = pick(ids.patients);
    const readRes = http.get(`${FHIR_URL}/Patient/${patientId}`, {headers: FHIR_HEADERS});
    if (readRes.status === 200) {
      const patient = readRes.json();
      patient.name = [{family: pick(FAMILY), given: [pick(GIVEN)]}];
      const updateRes = http.put(`${FHIR_URL}/Patient/${patientId}`, JSON.stringify(patient), {
        headers: {...FHIR_HEADERS, 'If-Match': readRes.headers['Etag'] || readRes.headers['etag'] || ''},
      });
      check(updateRes, {'update 200': (r) => r.status === 200});
    }

  } else {
    // 5% — CapabilityStatement
    const res = http.get(`${FHIR_URL}/metadata`, {headers: FHIR_HEADERS});
    check(res, {'metadata 200': (r) => r.status === 200});
  }
}
