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

import type { GraphNode, GraphGroup, GraphPhase, Position, Transform } from '../types/graph';

/** One view's saved layout — positions for every node + the viewport transform. */
export interface ViewLayout {
  positions: Record<string, Position>;
  transform: Transform;
}

/**
 * exportGraphToJson — serializes the node list to JSON and downloads it as a file.
 *
 * When layout data is provided the file is saved in a richer format:
 *   {
 *     nodes: [...],
 *     _layout: {
 *       currentView: 'dag' | 'lanes',
 *       dag:   { positions, transform } | null,
 *       lanes: { positions, transform } | null,
 *     }
 *   }
 * Both DAG and LANES layouts are captured so reloading the file restores whichever
 * view the user was in AND retains the other view's arrangement when they switch.
 *
 * @param nodes        - The complete list of nodes to export
 * @param currentView  - Which view is active right now
 * @param dagLayout    - DAG positions + transform (null if never used)
 * @param lanesLayout  - LANES positions + transform (null if never used)
 * @param filename     - Suggested filename (default: 'flowgraph.json')
 */
/**
 * buildExportPayload — builds the serializable graph data object.
 *
 * Shared by exportGraphToJson (download) and the in-place file-write path
 * so both always produce identical JSON.
 */
export function buildExportPayload(
  nodes: GraphNode[],
  currentView?: string,
  dagLayout?: ViewLayout | null,
  lanesLayout?: ViewLayout | null,
  groups?: GraphGroup[],
  phases?: GraphPhase[],
): object {
  const nodeData = nodes.map((node) => ({
    id: node.id,
    name: node.name,
    owner: node.owner,
    description: node.description,
    dependencies: node.dependencies,
  }));

  const hasLayout = dagLayout || lanesLayout;
  const hasGroups = groups && groups.length > 0;
  const hasPhases = phases && phases.length > 0;

  if (hasLayout) {
    return {
      nodes: nodeData,
      ...(hasGroups ? { groups } : {}),
      ...(hasPhases ? { phases } : {}),
      _layout: {
        currentView: currentView ?? 'dag',
        dag: dagLayout ?? null,
        lanes: lanesLayout ?? null,
      },
    };
  }

  if (hasGroups || hasPhases) {
    return {
      nodes: nodeData,
      ...(hasGroups ? { groups } : {}),
      ...(hasPhases ? { phases } : {}),
    };
  }

  return nodeData;
}

export function exportGraphToJson(
  nodes: GraphNode[],
  currentView?: string,
  dagLayout?: ViewLayout | null,
  lanesLayout?: ViewLayout | null,
  filename = 'flowgraph.json',
  groups?: GraphGroup[],
  phases?: GraphPhase[],
): void {
  const exportData = buildExportPayload(nodes, currentView, dagLayout, lanesLayout, groups, phases);
  const jsonString = JSON.stringify(exportData, null, 2);

  // Create a downloadable Blob from the JSON string
  const blob = new Blob([jsonString], { type: 'application/json' });
  const blobUrl = URL.createObjectURL(blob);

  // Create a temporary anchor element, click it to trigger download, then clean up
  const downloadLink = document.createElement('a');
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

  while (existingIds.has(`NODE-${String(counter).padStart(2, '0')}`)) {
    counter++;
  }

  return `NODE-${String(counter).padStart(2, '0')}`;
}
