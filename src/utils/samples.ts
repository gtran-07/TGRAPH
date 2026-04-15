import starterData from '../../public/samples/starter.json';
import bhsData from '../../public/samples/bhs-process-map.json';

export interface SampleMeta {
  id: string;
  label: string;
  description: string;
  /** Path relative to BASE_URL, e.g. "samples/starter.json" */
  file: string;
  /** Bundled JSON data — used directly so no fetch() is needed (works offline / file://) */
  data: unknown;
  nodeCount?: string;
}

export const SAMPLE_FILES: SampleMeta[] = [
  {
    id: 'starter',
    label: 'Starter Project',
    description: 'Simple 7-node software project workflow',
    file: 'samples/starter.json',
    data: starterData,
    nodeCount: '7 nodes',
  },
  {
    id: 'bhs',
    label: 'BHS Process Map',
    description: 'Real-world airport baggage handling system',
    file: 'samples/bhs-process-map.json',
    data: bhsData,
    nodeCount: '200+ nodes',
  },
];
