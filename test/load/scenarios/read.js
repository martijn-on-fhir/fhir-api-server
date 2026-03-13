import http from 'k6/http';
import {check, sleep} from 'k6';
import {SharedArray} from 'k6/data';
import {FHIR_URL, FHIR_HEADERS, READ_THRESHOLDS} from '../config.js';

const seedIds = new SharedArray('seedIds', () => [JSON.parse(open('../.seed-ids.json'))]);
const ids = seedIds[0];

export const options = {
  scenarios: {
    read_patients: {
      executor: 'ramping-rate',
      startRate: 10,
      stages: [
        {target: 100, duration: '15s'},  // ramp up
        {target: 200, duration: '30s'},  // sustain
        {target: 500, duration: '30s'},  // push to target
        {target: 500, duration: '30s'},  // sustain peak
        {target: 0, duration: '15s'},    // ramp down
      ],
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: READ_THRESHOLDS,
};

export default function () {
  // Mix of Patient, Observation, and Encounter reads
  const roll = Math.random();
  let url;

  if (roll < 0.4) {
    const id = ids.patients[Math.floor(Math.random() * ids.patients.length)];
    url = `${FHIR_URL}/Patient/${id}`;
  } else if (roll < 0.7) {
    const id = ids.observations[Math.floor(Math.random() * ids.observations.length)];
    url = `${FHIR_URL}/Observation/${id}`;
  } else if (roll < 0.9) {
    const id = ids.encounters[Math.floor(Math.random() * ids.encounters.length)];
    url = `${FHIR_URL}/Encounter/${id}`;
  } else {
    // CapabilityStatement (cached)
    url = `${FHIR_URL}/metadata`;
  }

  const res = http.get(url, {headers: FHIR_HEADERS});

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has resourceType': (r) => r.json('resourceType') !== undefined,
  });
}
