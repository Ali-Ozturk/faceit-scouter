const INCOMPLETE_UPLOADS = new Set(["AWAITING_UPLOAD", "UPLOADING"]);

export function uploadBatchIsReady(statuses: string[]) {
  return statuses.length > 0 && statuses.every(status => !INCOMPLETE_UPLOADS.has(status));
}
