"use client";

import { useEffect, useRef, useState } from "react";

type UploadSession = {
  id: string;
  mode: "SINGLE_PUT" | "MULTIPART";
  status: string;
  fileName: string;
  contentType: string;
  expectedSize: number;
  partSize: number | null;
  completedBytes: number;
  progressPercent: number;
  completedParts: Array<{ partNumber: number; etag: string; size: number }>;
  expiresAt: string;
  document: { id: string; status: string } | null;
};

type StoredResume = {
  sessionId: string;
  resumeToken: string;
  fileName: string;
  size: number;
  contentType: string;
  mode: "SINGLE_PUT" | "MULTIPART";
  partSize: number | null;
  partCount: number;
  savedAt: string;
};

type Props = {
  onUploaded?: (result: { documentId: string; sessionId: string }) => void;
};

const STORAGE_KEY = "investai:pdf-upload-v2:resume";
const RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms + Math.floor(Math.random() * 300)));
}

async function parseResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request gagal (${response.status}).`);
  return data;
}

function uploadWithProgress(input: {
  url: string;
  body: Blob;
  headers?: Record<string, string>;
  onProgress: (loaded: number) => void;
  registerXhr: (xhr: XMLHttpRequest | null) => void;
}): Promise<{ etag: string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    input.registerXhr(xhr);
    xhr.open("PUT", input.url);
    for (const [name, value] of Object.entries(input.headers || {})) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress(event.loaded);
    };
    xhr.onerror = () => reject(new Error("Koneksi upload terputus."));
    xhr.onabort = () => reject(new DOMException("Upload dijeda.", "AbortError"));
    xhr.onload = () => {
      input.registerXhr(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ etag: xhr.getResponseHeader("ETag") });
      } else {
        reject(new Error(`Bucket menolak upload (${xhr.status}).`));
      }
    };
    xhr.send(input.body);
  });
}

export function ResumablePdfUpload({ onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [resume, setResume] = useState<StoredResume | null>(null);
  const [session, setSession] = useState<UploadSession | null>(null);
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<"IDLE" | "PREPARING" | "UPLOADING" | "RETRYING" | "PAUSED" | "COMPLETING" | "DONE" | "ERROR">("IDLE");
  const [progress, setProgress] = useState(0);
  const [currentPart, setCurrentPart] = useState<number | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const pauseRequested = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setResume(JSON.parse(raw) as StoredResume);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  function persistResume(value: StoredResume | null) {
    setResume(value);
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  }

  function authHeaders(value = resume) {
    if (!value) throw new Error("Resume token tidak tersedia.");
    return { "x-upload-resume-token": value.resumeToken };
  }

  async function initiate(selected: File): Promise<StoredResume> {
    setPhase("PREPARING");
    setMessage("Menyiapkan upload aman…");
    const response = await fetch("/api/uploads/v2/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: selected.name,
        contentType: selected.type || "application/pdf",
        size: selected.size,
      }),
    });
    const data = await parseResponse(response);
    const record: StoredResume = {
      sessionId: data.session.id,
      resumeToken: data.resumeToken,
      fileName: selected.name,
      size: selected.size,
      contentType: selected.type || "application/pdf",
      mode: data.plan.mode,
      partSize: data.plan.partSize,
      partCount: data.plan.partCount,
      savedAt: new Date().toISOString(),
    };
    persistResume(record);
    setSession(data.session);
    if (record.mode === "SINGLE_PUT") {
      await uploadSingle(selected, record, data.plan.upload);
    }
    return record;
  }

  async function uploadSingle(
    selected: File,
    record: StoredResume,
    instruction?: { uploadUrl: string; requiredHeaders: Record<string, string> },
  ) {
    let upload = instruction;
    if (!upload) {
      throw new Error("Single upload URL sudah tidak tersedia. Batalkan session lalu mulai ulang.");
    }
    setPhase("UPLOADING");
    setMessage("Mengunggah PDF ke storage…");
    await uploadWithProgress({
      url: upload.uploadUrl,
      body: selected,
      headers: upload.requiredHeaders,
      onProgress: (loaded) => setProgress(Math.floor((loaded / selected.size) * 100)),
      registerXhr: (xhr) => { xhrRef.current = xhr; },
    });
    await complete(record);
  }

  async function reconcile(record: StoredResume) {
    const response = await fetch(`/api/uploads/v2/${record.sessionId}/reconcile`, {
      method: "POST",
      headers: authHeaders(record),
    });
    const data = await parseResponse(response);
    setSession(data.session);
    setProgress(data.session.progressPercent || 0);
    return data as { session: UploadSession; missingParts: number[]; objectPresent: boolean };
  }

  async function uploadPart(selected: File, record: StoredResume, partNumber: number, completedBytes: number) {
    if (!record.partSize) throw new Error("Multipart size tidak tersedia.");
    const start = (partNumber - 1) * record.partSize;
    const end = Math.min(selected.size, start + record.partSize);
    const blob = selected.slice(start, end);

    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
      if (pauseRequested.current) throw new DOMException("Upload dijeda.", "AbortError");
      try {
        setCurrentPart(partNumber);
        setPhase(attempt === 0 ? "UPLOADING" : "RETRYING");
        setMessage(attempt === 0
          ? `Mengunggah part ${partNumber}/${record.partCount}…`
          : `Mencoba ulang part ${partNumber}, percobaan ${attempt + 1}…`);
        const presign = await parseResponse(await fetch(
          `/api/uploads/v2/${record.sessionId}/parts/${partNumber}`,
          { method: "POST", headers: authHeaders(record) },
        ));
        const uploaded = await uploadWithProgress({
          url: presign.upload.uploadUrl,
          body: blob,
          headers: presign.upload.requiredHeaders,
          onProgress: (loaded) => setProgress(Math.min(99, Math.floor(((completedBytes + loaded) / selected.size) * 100))),
          registerXhr: (xhr) => { xhrRef.current = xhr; },
        });
        if (!uploaded.etag) {
          throw new Error("Bucket tidak mengekspos ETag. Periksa konfigurasi CORS ExposeHeaders.");
        }
        const acknowledgement = await parseResponse(await fetch(
          `/api/uploads/v2/${record.sessionId}/parts/${partNumber}`,
          {
            method: "PUT",
            headers: { ...authHeaders(record), "Content-Type": "application/json" },
            body: JSON.stringify({ etag: uploaded.etag, size: blob.size }),
          },
        ));
        setSession(acknowledgement.session);
        return blob.size;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        if (attempt === RETRY_DELAYS_MS.length - 1) throw error;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
    throw new Error("Part gagal setelah batas retry.");
  }

  async function uploadMultipart(selected: File, record: StoredResume) {
    const state = await reconcile(record);
    let completedBytes = state.session.completedBytes;
    for (const partNumber of state.missingParts) {
      const uploadedSize = await uploadPart(selected, record, partNumber, completedBytes);
      completedBytes += uploadedSize;
    }
    await complete(record);
  }

  async function complete(record: StoredResume) {
    setPhase("COMPLETING");
    setCurrentPart(null);
    setMessage("Menyelesaikan upload dan membuat antrean verifikasi…");
    const data = await parseResponse(await fetch(`/api/uploads/v2/${record.sessionId}/complete`, {
      method: "POST",
      headers: authHeaders(record),
    }));
    setSession(data.session);
    setProgress(100);
    setPhase("DONE");
    setMessage(data.message || "PDF berhasil diunggah.");
    persistResume(null);
    onUploaded?.({ documentId: data.document.id, sessionId: record.sessionId });
  }

  async function startOrResume() {
    if (!file) return;
    pauseRequested.current = false;
    setMessage("");
    setPhase("PREPARING");
    try {
      let record = resume;
      if (record) {
        if (record.fileName !== file.name || record.size !== file.size) {
          throw new Error(`Pilih kembali file yang sama: ${record.fileName} (${record.size} bytes).`);
        }
      } else {
        record = await initiate(file);
        if (record.mode === "SINGLE_PUT") return;
      }
      if (record.mode === "MULTIPART") await uploadMultipart(file, record);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setPhase("PAUSED");
        setMessage("Upload dijeda. Tekan Resume untuk melanjutkan dari part yang sudah tersimpan.");
      } else {
        setPhase("ERROR");
        setMessage(error instanceof Error ? error.message : "Upload gagal.");
      }
    }
  }

  function pause() {
    pauseRequested.current = true;
    xhrRef.current?.abort();
    setPhase("PAUSED");
  }

  async function abortUpload() {
    if (!resume) return;
    pause();
    try {
      const data = await parseResponse(await fetch(`/api/uploads/v2/${resume.sessionId}/abort`, {
        method: "POST",
        headers: authHeaders(resume),
      }));
      persistResume(null);
      setSession(data.session);
      setProgress(0);
      setCurrentPart(null);
      setPhase("IDLE");
      setMessage(data.cleanupWarning || "Upload dibatalkan.");
    } catch (error) {
      setPhase("ERROR");
      setMessage(error instanceof Error ? error.message : "Gagal membatalkan upload.");
    }
  }

  const active = ["PREPARING", "UPLOADING", "RETRYING", "COMPLETING"].includes(phase);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {resume && (
        <div className="callout">
          <b>Resume tersedia:</b> {resume.fileName}. Pilih kembali file yang sama, lalu tekan Resume.
        </div>
      )}
      <div className="field">
        <label>Financial Statement PDF</label>
        <input
          type="file"
          accept="application/pdf,.pdf"
          disabled={active}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setMessage("");
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn" type="button" disabled={!file || active} onClick={() => void startOrResume()}>
          {resume ? "Resume Upload" : "Upload PDF V2"}
        </button>
        {(phase === "UPLOADING" || phase === "RETRYING") && (
          <button className="btn secondary" type="button" onClick={pause}>Pause</button>
        )}
        {resume && (
          <button className="btn secondary" type="button" disabled={phase === "COMPLETING"} onClick={() => void abortUpload()}>
            Batalkan Upload
          </button>
        )}
      </div>
      {(active || phase === "PAUSED" || phase === "DONE" || progress > 0) && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span className="form-hint">{currentPart ? `Part ${currentPart}` : phase.replaceAll("_", " ")}</span>
            <b>{progress}%</b>
          </div>
          <progress value={progress} max={100} style={{ width: "100%", height: 18 }} />
        </div>
      )}
      {message && <div className="callout">{message}</div>}
      {session?.document && (
        <div className="form-hint">Document ID: {session.document.id} · {session.document.status}</div>
      )}
    </div>
  );
}
