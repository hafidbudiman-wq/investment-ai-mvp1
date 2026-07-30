import "server-only";
import type { DocumentStorage } from "@/lib/platform/storage/document-storage";
import { S3DocumentStorage } from "@/lib/platform/storage/s3-document-storage";
import { getStorageConfig } from "@/lib/platform/storage/storage-config";

let singleton: DocumentStorage | undefined;

export function getDocumentStorage(): DocumentStorage {
  if (!singleton) singleton = new S3DocumentStorage(getStorageConfig());
  return singleton;
}
