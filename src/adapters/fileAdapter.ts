/**
 * adapters/fileAdapter.ts — Loads and saves graph data using local JSON files
 * via the browser's native File API.
 *
 * This is the default adapter used when running FlowGraph as a standalone file
 * or without SharePoint connectivity.
 *
 * Load: reads a .json file selected by the user via a file input element.
 * Save: triggers a browser download of the current graph as a .json file.
 *
 * What does NOT belong here: any SharePoint, network, or authentication logic.
 */

import type { GraphAdapter, GraphNode } from '../types/graph';
import { exportGraphToJson } from '../utils/exportJson';

/**
 * FileAdapter — implements GraphAdapter using the browser File API.
 *
 * Usage:
 *   const adapter = new FileAdapter(fileFromInputElement);
 *   const nodes = await adapter.load();
 *   await adapter.save(updatedNodes);
 *
 * Note: A new FileAdapter must be created each time the user selects a file,
 * since the File object is tied to the specific file selection event.
 */
export class FileAdapter implements GraphAdapter {
  readonly label = 'Local File';

  /**
   * The File object from the browser's file input element.
   * This is set in the constructor and used by the load() method.
   * For save(), the file object is not used — we always write to a new download.
   */
  private readonly file: File | null;

  /**
   * @param file - The File object from a file input change event.
   *               Pass null if this adapter instance is only used for saving.
   */
  constructor(file: File | null = null) {
    this.file = file;
  }

  /**
   * load — reads the selected JSON file and parses it into GraphNode objects.
   *
   * Validates that the file contains a JSON array. Does NOT validate individual
   * node fields — missing fields are filled with sensible defaults.
   *
   * @throws Error if no file was provided, the file can't be read, or the JSON is invalid.
   * @returns Promise resolving to an array of GraphNode objects.
   */
  async load(): Promise<GraphNode[]> {
    if (!this.file) {
      throw new Error('No file provided. Create a new FileAdapter with a File object from a file input.');
    }

    // Read the file as text using the FileReader API (wrapped in a Promise for async/await)
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target?.result as string);
      reader.onerror = () => reject(new Error(`Failed to read file: ${this.file!.name}`));
      reader.readAsText(this.file!);
    });

    // Parse and validate
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Invalid JSON file. Make sure the file is valid JSON.');
    }

    if (!Array.isArray(parsed)) {
      throw new Error('JSON file must contain an array of node objects: [{ "id": "...", ... }]');
    }

    // Map raw JSON objects to GraphNode, filling in defaults for missing fields
    return (parsed as Record<string, unknown>[]).map((rawNode) => ({
      id: String(rawNode.id ?? ''),
      name: String(rawNode.name ?? rawNode.id ?? 'Unnamed'),
      owner: String(rawNode.owner ?? 'Unknown'),
      description: String(rawNode.description ?? ''),
      dependencies: Array.isArray(rawNode.dependencies)
        ? rawNode.dependencies.map(String)
        : [],
    }));
  }

  /**
   * save — downloads the current node list as a JSON file.
   *
   * The download filename is 'flowgraph.json' by default.
   * Uses the exportGraphToJson utility to serialize and trigger the download.
   *
   * @param nodes - The complete current node list to save.
   */
  async save(nodes: GraphNode[]): Promise<void> {
    exportGraphToJson(nodes, 'flowgraph.json');
  }
}
