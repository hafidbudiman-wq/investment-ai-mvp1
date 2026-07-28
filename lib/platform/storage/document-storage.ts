import type { Readable } from "node:stream";

export type StorageProviderName = "RAILWAY" | "S3" | "R2";
export type UploadMode = "SINGLE_PUT" | "MULTIPART";

export type ObjectLocation = {
  provider: StorageProviderName;
  bucket: string;
  objectKey: string;
};

export type ObjectHead = ObjectLocation & {
  contentLength: number;
  contentType: string | null;
  etag: string | null;
  lastModified: Date | null;
  metadata: Record<string, string>;
};

export type SingleUploadInstruction = ObjectLocation & {
  mode: "SINGLE_PUT";
  uploadUrl: string;
  expiresAt: Date;
  requiredHeaders: Record<string, string>;
};

export type MultipartUpload = ObjectLocation & {
  mode: "MULTIPART";
  providerUploadId: string;
  expiresAt: Date;
};

export type MultipartPartInstruction = {
  partNumber: number;
  uploadUrl: string;
  expiresAt: Date;
  requiredHeaders: Record<string, string>;
};

export type CompletedPart = {
  partNumber: number;
  etag: string;
};

export interface DocumentStorage {
  readonly provider: StorageProviderName;

  createSingleUpload(input: {
    objectKey: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
    metadata?: Record<string, string>;
  }): Promise<SingleUploadInstruction>;

  initiateMultipartUpload(input: {
    objectKey: string;
    contentType: string;
    expiresInSeconds: number;
    metadata?: Record<string, string>;
  }): Promise<MultipartUpload>;

  presignMultipartPart(input: {
    objectKey: string;
    providerUploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }): Promise<MultipartPartInstruction>;

  completeMultipartUpload(input: {
    objectKey: string;
    providerUploadId: string;
    parts: CompletedPart[];
  }): Promise<ObjectHead>;

  abortMultipartUpload(input: {
    objectKey: string;
    providerUploadId: string;
  }): Promise<void>;

  headObject(location: Pick<ObjectLocation, "objectKey">): Promise<ObjectHead>;

  openReadStream(location: Pick<ObjectLocation, "objectKey">, range?: { start: number; end?: number }): Promise<Readable>;

  deleteObject(location: Pick<ObjectLocation, "objectKey">): Promise<void>;
}
