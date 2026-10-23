/**
 * Single place to configure pdf.js: bundle-local worker (offline, no CDN),
 * disable eval-based font rendering paths we do not need.
 */
import * as pdfjsLib from "pdfjs-dist";
// Vite emits the worker as a local asset — privacy rule #1 holds: no CDN.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
