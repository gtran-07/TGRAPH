/**
 * utils/exportJson.ts — Serializes graph state back to the canonical JSON format
 * and triggers a browser file download.
 *
 * The exported JSON format is identical to the format expected on import,
 * so exported files can be immediately re-loaded into FlowGraph.
 *
 * What belongs here: serialization logic, download triggering.
 * What does NOT belong here: any React state, DOM manipulation beyond the download link.
 */

import type {
  GraphNode,
  GraphGroup,
  GraphPhase,
  GraphMeta,
  NodeTag,
  PathType,
} from "../types/graph";

const DEFAULT_META: GraphMeta = {
  note: "This is a FlowGraph chart file. Open it with the FlowGraph app to view and edit the interactive dependency flowchart.",
  app: "https://gtran-07.github.io/TGRAPH/",
  author: "Giang Tran",
  usage:
    "In the app: click the folder icon (or drag-and-drop this file) to load it. Use Design Mode to edit nodes, groups, and phases.",
};

/**
 * buildExportPayload — builds the serializable graph data object.
 *
 * Shared by exportGraphToJson (download) and the in-place file-write path
 * so both always produce identical JSON. Layout (positions/transform) is
 * intentionally excluded — the app recomputes layout automatically on load.
 */
export function buildExportPayload(
  nodes: GraphNode[],
  groups?: GraphGroup[],
  phases?: GraphPhase[],
  tagRegistry?: NodeTag[],
  ownerRegistry?: string[],
  meta?: GraphMeta | null,
  edgePathTypes?: Record<string, PathType>,
): object {
  const nodeData = nodes.map((node) => ({
    id: node.id,
    name: node.name,
    owner: node.owner,
    description: node.description,
    dependencies: node.dependencies,
    ...(node.tags && node.tags.length > 0 ? { tags: node.tags } : {}),
    ...(node.cinemaScript ? { cinemaScript: node.cinemaScript } : {}),
    ...(node.cinemaBottleneck ? { cinemaBottleneck: true } : {}),
    ...(node.cinemaSkip ? { cinemaSkip: true } : {}),
  }));

  const hasGroups = groups && groups.length > 0;
  const hasPhases = phases && phases.length > 0;
  const hasTagRegistry = tagRegistry && tagRegistry.length > 0;
  const hasOwnerRegistry = ownerRegistry && ownerRegistry.length > 0;
  const hasEdgePathTypes = edgePathTypes && Object.keys(edgePathTypes).length > 0;

  const phasesData = phases?.map((p) => ({
    ...p,
    ...(p.groupIds && p.groupIds.length > 0
      ? { groupIds: p.groupIds }
      : { groupIds: undefined }),
  }));

  const _meta: GraphMeta = { ...DEFAULT_META, ...meta };

  return {
    _meta,
    nodes: nodeData,
    ...(hasGroups ? { groups } : {}),
    ...(hasPhases ? { phases: phasesData } : {}),
    ...(hasTagRegistry ? { tagRegistry } : {}),
    ...(hasOwnerRegistry ? { ownerRegistry } : {}),
    ...(hasEdgePathTypes ? { edgePathTypes } : {}),
  };
}

export function exportGraphToJson(
  nodes: GraphNode[],
  filename = "flowgraph.json",
  groups?: GraphGroup[],
  phases?: GraphPhase[],
  tagRegistry?: NodeTag[],
  ownerRegistry?: string[],
  meta?: GraphMeta | null,
  edgePathTypes?: Record<string, PathType>,
): void {
  const exportData = buildExportPayload(
    nodes,
    groups,
    phases,
    tagRegistry,
    ownerRegistry,
    meta,
    edgePathTypes,
  );
  const jsonString = JSON.stringify(exportData, null, 2);

  // Create a downloadable Blob from the JSON string
  const blob = new Blob([jsonString], { type: "application/json" });
  const blobUrl = URL.createObjectURL(blob);

  // Create a temporary anchor element, click it to trigger download, then clean up
  const downloadLink = document.createElement("a");
  downloadLink.href = blobUrl;
  downloadLink.download = filename;
  downloadLink.click();

  // Revoke the Blob URL after a short delay to give the browser time to start the download
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

/**
 * generateNodeId — creates a unique node ID that doesn't conflict with existing nodes.
 *
 * Uses the format "NODE-XX" where XX is a zero-padded number.
 * Increments until it finds a number not already in use.
 *
 * @param existingNodes - The current list of nodes to check for ID conflicts
 * @returns             - A unique ID string like "NODE-07"
 */
export function generateNodeId(existingNodes: GraphNode[]): string {
  const existingIds = new Set(existingNodes.map((node) => node.id));
  let counter = existingNodes.length + 1;

  while (existingIds.has(`NODE-${String(counter).padStart(2, "0")}`)) {
    counter++;
  }

  return `NODE-${String(counter).padStart(2, "0")}`;
}
