import {MongoClient, Db} from 'mongodb';

/** Holds the source and target MongoDB connections. */
export interface DbConnections {
  sourceClient: MongoClient;
  targetClient: MongoClient;
  sourceDb: Db;
  targetDb: Db;
}

/** Connect to source and target MongoDB instances. */
export async function connect(sourceUri: string, targetUri: string): Promise<DbConnections> {
  const sourceClient = new MongoClient(sourceUri);
  const targetClient = new MongoClient(targetUri);
  await Promise.all([sourceClient.connect(), targetClient.connect()]);
  const sourceDb = sourceClient.db();
  const targetDb = targetClient.db();

  return {sourceClient, targetClient, sourceDb, targetDb};
}

/** Close both MongoDB connections. */
export async function disconnect(conns: DbConnections): Promise<void> {
  await Promise.all([conns.sourceClient.close(), conns.targetClient.close()]);
}
