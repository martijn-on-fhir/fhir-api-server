import { readFileSync } from 'fs';
import { resolve } from 'path';
import { MongoClient } from 'mongodb';

/** Seeds SearchParameter resources from the test fixture into the conformance_resources collection. */
export async function seedSearchParameters(mongoUri: string): Promise<number> {
  const bundle = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/r4-search-parameters.json'), 'utf-8'));
  const docs = (bundle.entry || []).map((e: any) => e.resource).filter((r: any) => r?.resourceType === 'SearchParameter' && r.code && r.expression);
  if (docs.length === 0) return 0;
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db();
    await db.collection('conformance_resources').insertMany(docs);
    return docs.length;
  } finally {
    await client.close();
  }
}