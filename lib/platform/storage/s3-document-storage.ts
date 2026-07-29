import { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  CompletedPart,
  DocumentStorage,
  MultipartPartInstruction,
  MultipartUpload,
  ObjectHead,
  SingleUploadInstruction,
  StorageProviderName,
} from "@/lib/platform/storage/document-storage";
import type { StorageConfig } from "@/lib/platform/storage/storage-config";

function normalizeEtag(value: string | undefined): string | null {
  if (!value) return null;
  return value.replace(/^\"|\"$/g, "");
}

export class S3DocumentStorage implements DocumentStorage {
  readonly provider: StorageProviderName;
  private readonly client: S3Client;

  constructor(private readonly config: StorageConfig) {
    this.provider = config.provider;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  private location(objectKey: string) {
    return {
      provider: this.provider,
      bucket: this.config.bucket,
      objectKey,
    } as const;
  }

  async createSingleUpload(input: {
    objectKey: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
    metadata?: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<SingleUploadInstruction> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
      Metadata: input.metadata,
    });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds,
    });
    return {
      ...this.location(input.objectKey),
      mode: "SINGLE_PUT",
      uploadUrl,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
      requiredHeaders: {
        "content-type": input.contentType,
      },
    };
  }

  async initiateMultipartUpload(input: {
    objectKey: string;
    contentType: string;
    expiresInSeconds: number;
    metadata?: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<MultipartUpload> {
    const response = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: input.objectKey,
        ContentType: input.contentType,
        Metadata: input.metadata,
      }),
      { abortSignal: input.signal },
    );
    if (!response.UploadId) throw new Error("Storage provider did not return a multipart upload ID.");
    return {
      ...this.location(input.objectKey),
      mode: "MULTIPART",
      providerUploadId: response.UploadId,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async presignMultipartPart(input: {
    objectKey: string;
    providerUploadId: string;
    partNumber: number;
    expiresInSeconds: number;
    signal?: AbortSignal;
  }): Promise<MultipartPartInstruction> {
    const uploadUrl = await getSignedUrl(
      this.client,
      new UploadPartCommand({
        Bucket: this.config.bucket,
        Key: input.objectKey,
        UploadId: input.providerUploadId,
        PartNumber: input.partNumber,
      }),
      { expiresIn: input.expiresInSeconds },
    );
    return {
      partNumber: input.partNumber,
      uploadUrl,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
      requiredHeaders: {},
    };
  }

  async listMultipartParts(input: {
    objectKey: string;
    providerUploadId: string;
    signal?: AbortSignal;
  }): Promise<CompletedPart[]> {
    const parts: CompletedPart[] = [];
    let marker: string | undefined;
    do {
      const response = await this.client.send(
        new ListPartsCommand({
          Bucket: this.config.bucket,
          Key: input.objectKey,
          UploadId: input.providerUploadId,
          PartNumberMarker: marker,
        }),
        { abortSignal: input.signal },
      );
      for (const part of response.Parts ?? []) {
        const etag = normalizeEtag(part.ETag);
        if (part.PartNumber && etag) parts.push({ partNumber: part.PartNumber, etag });
      }
      marker = response.IsTruncated ? response.NextPartNumberMarker : undefined;
    } while (marker);
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(input: {
    objectKey: string;
    providerUploadId: string;
    parts: CompletedPart[];
    signal?: AbortSignal;
  }): Promise<ObjectHead> {
    const sorted = [...input.parts].sort((a, b) => a.partNumber - b.partNumber);
    if (sorted.length === 0) throw new Error("Cannot complete multipart upload without parts.");
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: input.objectKey,
        UploadId: input.providerUploadId,
        MultipartUpload: {
          Parts: sorted.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
        },
      }),
      { abortSignal: input.signal },
    );
    return this.headObject({ objectKey: input.objectKey, signal: input.signal });
  }

  async abortMultipartUpload(input: {
    objectKey: string;
    providerUploadId: string;
    signal?: AbortSignal;
  }): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: input.objectKey,
        UploadId: input.providerUploadId,
      }),
      { abortSignal: input.signal },
    );
  }

  async headObject(input: { objectKey: string; signal?: AbortSignal }): Promise<ObjectHead> {
    const response = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: input.objectKey }),
      { abortSignal: input.signal },
    );
    if (response.ContentLength == null) throw new Error("Storage object has no content length.");
    return {
      ...this.location(input.objectKey),
      contentLength: response.ContentLength,
      contentType: response.ContentType ?? null,
      etag: normalizeEtag(response.ETag),
      lastModified: response.LastModified ?? null,
      metadata: response.Metadata ?? {},
    };
  }

  async openReadStream(
    input: { objectKey: string; signal?: AbortSignal },
    range?: { start: number; end?: number },
  ): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: input.objectKey,
        Range: range ? `bytes=${range.start}-${range.end ?? ""}` : undefined,
      }),
      { abortSignal: input.signal },
    );
    if (!response.Body) throw new Error("Storage provider returned an empty object body.");
    if (response.Body instanceof Readable) return response.Body;
    return Readable.fromWeb(response.Body.transformToWebStream() as never);
  }

  async deleteObject(input: { objectKey: string; signal?: AbortSignal }): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: input.objectKey }),
      { abortSignal: input.signal },
    );
  }
}
