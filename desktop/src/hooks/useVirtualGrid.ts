/**
 * Windowed rendering for the cover grid (Step 5: virtualized lists).
 *
 * A plain CSS grid renders every card — with a large library that means
 * thousands of <img> elements. This hook computes the column count from the
 * container width, maps visible rows (+ overscan) to a flat slice range and
 * pads with spacers, so the DOM stays O(viewport) regardless of library
 * size. No external dependency.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface VirtualGridGeometry {
  /** Columns that fit the container at minCardWidth. */
  columns: number;
  /** Rendered card width in px (stretched to fill the row). */
  cardWidth: number;
  /** Cover height (2:3 aspect) + caption block + gap. */
  rowHeight: number;
  /** Index of the first rendered item (inclusive). */
  startIndex: number;
  /** Index of the last rendered item (exclusive). */
  endIndex: number;
  /** Total scrollable height in px (drives the bottom spacer). */
  totalHeight: number;
  /** Height of the top spacer in px. */
  topPad: number;
}

export interface UseVirtualGridOptions {
  itemCount: number;
  minCardWidth?: number;
  gap?: number;
  /** Caption block height below the cover (title/author/progress). */
  captionHeight?: number;
  /** Cover aspect ratio (height / width). */
  coverAspect?: number;
  overscanRows?: number;
}

const INITIAL: VirtualGridGeometry = {
  columns: 1,
  cardWidth: 0,
  rowHeight: 0,
  startIndex: 0,
  endIndex: 0,
  totalHeight: 0,
  topPad: 0,
};

export function useVirtualGrid({
  itemCount,
  minCardWidth = 150,
  gap = 16,
  captionHeight = 84,
  coverAspect = 1.5,
  overscanRows = 2,
}: UseVirtualGridOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const raf = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
        setViewportHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    setViewportHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    if (raf.current != null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      setScrollTop(containerRef.current?.scrollTop ?? 0);
    });
  }, []);

  useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    },
    [],
  );

  const geo: VirtualGridGeometry = (() => {
    if (width <= 0) return INITIAL;
    const columns = Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
    const cardWidth = (width - (columns - 1) * gap) / columns;
    const coverHeight = Math.round(cardWidth * coverAspect);
    const rowHeight = coverHeight + captionHeight + gap;
    const rows = Math.ceil(itemCount / columns);
    const firstVisibleRow = Math.floor(scrollTop / rowHeight);
    const visibleRows =
      Math.ceil(viewportHeight / rowHeight) + 1 + overscanRows * 2;
    const startRow = Math.max(0, firstVisibleRow - overscanRows);
    const endRow = Math.min(rows, firstVisibleRow + visibleRows);
    return {
      columns,
      cardWidth,
      rowHeight,
      startIndex: startRow * columns,
      endIndex: Math.min(itemCount, endRow * columns),
      totalHeight: rows * rowHeight,
      topPad: startRow * rowHeight,
    };
  })();

  return { containerRef, onScroll, geo } as const;
}
