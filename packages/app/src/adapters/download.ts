/** Browser-Adapter: Bytes als Datei herunterladen (Blob-URL + `<a download>`). */
export interface DownloadFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly mime: string;
}

export function downloadFile(file: DownloadFile): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(file.bytes)], { type: file.mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Erst nach dem Start des Downloads freigeben (sonst bricht er in manchen Browsern ab).
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
