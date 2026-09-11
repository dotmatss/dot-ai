"use client";

import { Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";

import { AppButton } from "@/components/ui/app-button";
import { WorkflowPreviewNode } from "@/features/workflows/components/workflow-preview-node";
import { neighbourhoodOf, type PreviewGraph } from "@/features/workflows/domain/preview";
import { cn } from "@/lib/cn";

/**
 * Read-only viewport over a `PreviewGraph`.
 *
 * Navigation only: the canvas pans, zooms and fits, and selecting a node
 * reports it upwards. Nothing here can move a node, retarget an edge or touch
 * a config — the preview never receives an editing callback, so a mutation is
 * not merely disabled, it is unrepresentable.
 */

const MIN_SCALE = 0.3;
const MAX_SCALE = 2;
const ZOOM_STEP = 1.25;
/** Breathing room around the graph when fitting. */
const FIT_MARGIN = 16;

interface Viewport {
  scale: number;
  x: number;
  y: number;
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export interface WorkflowPreviewCanvasProps {
  graph: PreviewGraph;
  selectedNodeId: string | null;
  onSelect: (nodeId: string | null) => void;
  /** True when run states are meaningful; a static preview leaves this off. */
  showStates?: boolean;
  className?: string;
}

export function WorkflowPreviewCanvas({
  graph,
  selectedNodeId,
  onSelect,
  showStates = false,
  className,
}: WorkflowPreviewCanvasProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, x: 0, y: 0 });
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const arrowId = useId();

  const highlight = neighbourhoodOf(graph, selectedNodeId);

  const fit = useCallback(() => {
    const element = viewportRef.current;
    if (!element || graph.empty) return;
    const { clientWidth, clientHeight } = element;
    if (clientWidth === 0 || clientHeight === 0) return;
    const scale = clampScale(
      Math.min((clientWidth - FIT_MARGIN * 2) / graph.width, (clientHeight - FIT_MARGIN * 2) / graph.height, 1),
    );
    setViewport({
      scale,
      x: (clientWidth - graph.width * scale) / 2,
      y: (clientHeight - graph.height * scale) / 2,
    });
  }, [graph.empty, graph.width, graph.height]);

  // Fit before paint so the graph never flashes at the wrong size, and re-fit
  // when the graph's extent changes (a step added, a branch wired).
  useLayoutEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);

  /** Zooms about the centre of the viewport so the focus of attention stays put. */
  const zoomBy = useCallback((factor: number) => {
    const element = viewportRef.current;
    setViewport((current) => {
      const next = clampScale(current.scale * factor);
      if (next === current.scale) return current;
      const centreX = (element?.clientWidth ?? 0) / 2;
      const centreY = (element?.clientHeight ?? 0) / 2;
      const ratio = next / current.scale;
      return { scale: next, x: centreX - (centreX - current.x) * ratio, y: centreY - (centreY - current.y) * ratio };
    });
  }, []);

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    // Only a pinch or a ctrl-wheel zooms; a plain wheel keeps scrolling the
    // page, which is what a reader expects from a panel inside a form.
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const element = viewportRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    setViewport((current) => {
      const next = clampScale(current.scale * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
      if (next === current.scale) return current;
      const ratio = next / current.scale;
      return { scale: next, x: pointerX - (pointerX - current.x) * ratio, y: pointerY - (pointerY - current.y) * ratio };
    });
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    // Let a node take its own click; only the background pans.
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-node-id]")) return;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    setViewport((current) => ({
      ...current,
      x: pan.originX + (event.clientX - pan.startX),
      y: pan.originY + (event.clientY - pan.startY),
    }));
  }

  function endPan(event: PointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div className={cn("relative overflow-hidden rounded-lg border border-border bg-surface-muted", className)}>
      <div
        ref={viewportRef}
        data-testid="workflow-preview-viewport"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        className={cn("size-full touch-none", panning ? "cursor-grabbing" : "cursor-grab")}
      >
        <div
          style={{
            width: graph.width,
            height: graph.height,
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
            transformOrigin: "0 0",
          }}
          className="relative"
        >
          <svg
            aria-hidden
            width={graph.width}
            height={graph.height}
            viewBox={`0 0 ${graph.width} ${graph.height}`}
            className="absolute inset-0 overflow-visible"
          >
            <defs>
              <marker id={`${arrowId}-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L8 4 L0 8 z" className="fill-border-strong" />
              </marker>
            </defs>
            {graph.edges.map((edge) => {
              const dimmed = highlight !== null && !highlight.edgeIds.has(edge.id);
              return (
                <path
                  key={edge.id}
                  d={edge.path}
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray={edge.back ? "4 4" : undefined}
                  markerEnd={`url(#${arrowId}-arrow)`}
                  className={cn("stroke-border-strong transition-opacity", dimmed ? "opacity-25" : "opacity-100")}
                />
              );
            })}
          </svg>

          {/* Branch labels ride above the paths so "If true" stays legible. */}
          {graph.edges
            .filter((edge) => edge.label !== null)
            .map((edge) => {
              const dimmed = highlight !== null && !highlight.edgeIds.has(edge.id);
              return (
                <span
                  key={`${edge.id}-label`}
                  aria-hidden
                  style={{ left: edge.labelX, top: edge.labelY }}
                  className={cn(
                    "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-surface px-2 py-0.5 text-caption font-medium text-foreground-secondary transition-opacity",
                    dimmed ? "opacity-25" : "opacity-100",
                  )}
                >
                  {edge.label}
                </span>
              );
            })}

          <ul aria-label="Workflow steps" className="contents">
            {graph.nodes.map((node) => (
              <li key={node.id} className="contents">
                <WorkflowPreviewNode
                  node={node}
                  selected={selectedNodeId === node.id}
                  dimmed={highlight !== null && !highlight.nodeIds.has(node.id)}
                  showState={showStates}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md border border-border bg-surface p-1 shadow-xs">
        <AppButton
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={viewport.scale <= MIN_SCALE}
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        >
          <Minus aria-hidden />
        </AppButton>
        <span aria-live="polite" className="min-w-11 text-center text-caption tabular-nums text-foreground-muted">
          {Math.round(viewport.scale * 100)}%
        </span>
        <AppButton
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={viewport.scale >= MAX_SCALE}
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          <Plus aria-hidden />
        </AppButton>
        <AppButton variant="ghost" size="icon-sm" aria-label="Fit workflow to view" title="Fit workflow to view" onClick={fit}>
          <Maximize2 aria-hidden />
        </AppButton>
        <AppButton
          variant="ghost"
          size="icon-sm"
          aria-label="Reset view"
          title="Reset view"
          onClick={() => {
            onSelect(null);
            fit();
          }}
        >
          <RotateCcw aria-hidden />
        </AppButton>
      </div>
    </div>
  );
}
