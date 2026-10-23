/**
 * Minimal type declarations for the epub.js API surface Vellum uses.
 * (The `epubjs` npm package ships no types of its own.)
 */

declare module "epubjs" {
  export interface BookOptions {
    /** Open the book from an in-memory ArrayBuffer — no fetch, no network. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }

  export interface BookMetadata {
    title?: string;
    creator?: string;
  }

  export interface NavItem {
    href: string;
    label: string;
  }

  export class Book {
    constructor(urlOrData: ArrayBuffer, options?: BookOptions);
    readonly ready: Promise<BookMetadata>;
    readonly loaded: {
      manifest: Promise<unknown>;
      spine: Promise<unknown>;
      metadata: Promise<BookMetadata>;
      cover: Promise<string>;
      navigation: Promise<{ toc: NavItem[] }>;
    };
    readonly spine: { length: number };
    renderTo(
      element: HTMLElement | string,
      options?: RenditionOptions,
    ): Rendition;
    destroy(): Promise<void>;
  }

  export interface RenditionOptions {
    width?: string | number;
    height?: string | number;
    flow?: string;
    spread?: string;
    allowScriptedContent?: boolean;
  }

  export interface RelocatedLocation {
    start: {
      cfi: string;
      index: number;
      displayed?: { page: number; total: number };
      percentage?: number | null;
    };
    end?: {
      cfi: string;
      percentage?: number | null;
    };
  }

  export class Rendition {
    display(target?: string | number): Promise<unknown>;
    prev(): Promise<unknown>;
    next(): Promise<unknown>;
    resize?(width?: string | number, height?: string | number): void;
    themes: {
      register(name: string, css: Record<string, unknown>): void;
      select(name: string): void;
      default(css: Record<string, unknown>): void;
      fontSize(size: string): void;
    };
    on(event: string, handler: (...args: any[]) => void): void;
    off(event: string, handler: (...args: any[]) => void): void;
    destroy(): Promise<void>;
    currentLocation(): RelocatedLocation | undefined;
  }

  export default function ePub(
    urlOrData: ArrayBuffer,
    options?: BookOptions,
  ): Book;
}
