import { readFileSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config/app-config';

/** Remote backup storage type. Configured via centralized config. */
const REMOTE_TYPE = config.backup.remoteType.toLowerCase();

/* eslint-disable @typescript-eslint/no-require-imports */
/** Dynamically require an optional dependency. Throws a clear error if not installed. */
const optionalRequire = (pkg: string): any => {
 try {
 return require(pkg); 
} catch {
 throw new Error(`Package '${pkg}' is required for ${REMOTE_TYPE} backups. Install it: npm install ${pkg}`); 
} 
};
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Uploads backups to remote cloud storage (AWS S3 or Azure Blob Storage).
 * SDKs are optional dependencies loaded via require() at runtime.
 * S3: `npm install @aws-sdk/client-s3`, Azure: `npm install @azure/storage-blob`.
 */
@Injectable()
export class BackupRemoteService {

  private readonly logger = new Logger(BackupRemoteService.name);

  /** Returns true if remote backup is configured. */
  isEnabled(): boolean {
    return REMOTE_TYPE === 's3' || REMOTE_TYPE === 'azure';
  }

  /** Upload a backup file to the configured remote storage. */
  async upload(filePath: string): Promise<{ remote: string; provider: string }> {
    if (REMOTE_TYPE === 's3') {
return this.uploadToS3(filePath);
}

    if (REMOTE_TYPE === 'azure') {
return this.uploadToAzure(filePath);
}

    return { remote: 'none', provider: 'none' };
  }

  /** List remote backups. */
  async listRemote(): Promise<{ key: string; size: number; lastModified: string }[]> {
    if (REMOTE_TYPE === 's3') {
return this.listS3();
}

    if (REMOTE_TYPE === 'azure') {
return this.listAzure();
}

    return [];
  }

  /** Download a backup from remote storage to a local path. */
  async download(remoteKey: string, localPath: string): Promise<void> {
    const resolved = resolve(localPath);
    const backupDir = resolve(config.backup.dir);

    if (!resolved.startsWith(backupDir)) {
      throw new Error('Download path must be within the backup directory');
    }

    if (REMOTE_TYPE === 's3') {
return this.downloadFromS3(remoteKey, localPath);
}

    if (REMOTE_TYPE === 'azure') {
return this.downloadFromAzure(remoteKey, localPath);
}
  }

  // --- AWS S3 ---

  private async uploadToS3(filePath: string): Promise<{ remote: string; provider: string }> {
    const { S3Client, PutObjectCommand } = optionalRequire('@aws-sdk/client-s3');
    const bucket = config.backup.s3.bucket;

    if (!bucket) {
throw new Error('backup.s3.bucket is required when backup.remoteType=s3');
}

    const prefix = config.backup.s3.prefix;
    const key = `${prefix}${basename(filePath)}`;
    const region = config.backup.s3.region;
    const client = new S3Client(region ? { region } : {});

    this.logger.log(`Uploading ${basename(filePath)} to s3://${bucket}/${key}...`);
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: readFileSync(filePath), ContentType: 'application/gzip' }));
    this.logger.log(`Upload complete: s3://${bucket}/${key}`);

    return { remote: `s3://${bucket}/${key}`, provider: 's3' };
  }

  private async listS3(): Promise<{ key: string; size: number; lastModified: string }[]> {
    const { S3Client, ListObjectsV2Command } = optionalRequire('@aws-sdk/client-s3');
    const bucket = config.backup.s3.bucket;

    if (!bucket) {
return [];
}

    const prefix = config.backup.s3.prefix;
    const region = config.backup.s3.region;
    const client = new S3Client(region ? { region } : {});
    const response = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));

    return (response.Contents || []).filter((o: any) => o.Key?.endsWith('.gz')).map((o: any) => ({ key: o.Key || '', size: o.Size || 0, lastModified: o.LastModified?.toISOString() || '' }));
  }

  private async downloadFromS3(remoteKey: string, localPath: string): Promise<void> {
    const { S3Client, GetObjectCommand } = optionalRequire('@aws-sdk/client-s3');
    const bucket = config.backup.s3.bucket;

    if (!bucket) {
throw new Error('backup.s3.bucket is required');
}

    const region = config.backup.s3.region;
    const client = new S3Client(region ? { region } : {});
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: remoteKey }));
    const body = await response.Body?.transformToByteArray();

    if (body) {
writeFileSync(localPath, body);
}

    this.logger.log(`Downloaded ${remoteKey} from S3 to ${localPath}`);
  }

  // --- Azure Blob Storage ---

  private async uploadToAzure(filePath: string): Promise<{ remote: string; provider: string }> {
    const { BlobServiceClient } = optionalRequire('@azure/storage-blob');
    const connectionString = config.backup.azure.connectionString;
    const containerName = config.backup.azure.container;

    if (!connectionString || !containerName) {
throw new Error('backup.azure.connectionString and backup.azure.container are required when backup.remoteType=azure');
}

    const prefix = config.backup.azure.prefix;
    const blobName = `${prefix}${basename(filePath)}`;
    const client = BlobServiceClient.fromConnectionString(connectionString);
    const container = client.getContainerClient(containerName);
    await container.createIfNotExists();
    const blob = container.getBlockBlobClient(blobName);

    this.logger.log(`Uploading ${basename(filePath)} to azure://${containerName}/${blobName}...`);
    await blob.uploadFile(filePath);
    this.logger.log(`Upload complete: azure://${containerName}/${blobName}`);

    return { remote: `azure://${containerName}/${blobName}`, provider: 'azure' };
  }

  private async listAzure(): Promise<{ key: string; size: number; lastModified: string }[]> {
    const { BlobServiceClient } = optionalRequire('@azure/storage-blob');
    const connectionString = config.backup.azure.connectionString;
    const containerName = config.backup.azure.container;

    if (!connectionString || !containerName) {
return [];
}

    const prefix = config.backup.azure.prefix;
    const client = BlobServiceClient.fromConnectionString(connectionString);
    const container = client.getContainerClient(containerName);
    const results: { key: string; size: number; lastModified: string }[] = [];

    for await (const blob of container.listBlobsFlat({ prefix })) {
      if (blob.name.endsWith('.gz')) {
        results.push({ key: blob.name, size: blob.properties.contentLength || 0, lastModified: blob.properties.lastModified?.toISOString() || '' });
      }
    }

    return results;
  }

  private async downloadFromAzure(remoteKey: string, localPath: string): Promise<void> {
    const { BlobServiceClient } = optionalRequire('@azure/storage-blob');
    const connectionString = config.backup.azure.connectionString;
    const containerName = config.backup.azure.container;

    if (!connectionString || !containerName) {
throw new Error('backup.azure.connectionString and backup.azure.container are required');
}

    const client = BlobServiceClient.fromConnectionString(connectionString);
    const container = client.getContainerClient(containerName);
    const blob = container.getBlockBlobClient(remoteKey);
    await blob.downloadToFile(localPath);
    this.logger.log(`Downloaded ${remoteKey} from Azure to ${localPath}`);
  }
}
