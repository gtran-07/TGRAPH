import smallData   from '../../public/samples/small.json';
import mediumData  from '../../public/samples/medium.json';
import largeData   from '../../public/samples/large.json';
import xlargeData  from '../../public/samples/xlarge.json';

export interface SampleMeta {
  id: string;
  label: string;
  description: string;
  /** Path relative to BASE_URL, e.g. "samples/small.json" */
  file: string;
  /** Bundled JSON data — used directly so no fetch() is needed (works offline / file://) */
  data: unknown;
  nodeCount?: string;
}

export const SAMPLE_FILES: SampleMeta[] = [
  {
    id: 'small',
    label: 'Employee Onboarding',
    description: 'Simple 9-node workflow — great starting point',
    file: 'samples/small.json',
    data: smallData,
    nodeCount: '9 nodes',
  },
  {
    id: 'medium',
    label: 'Software Product Lifecycle',
    description: 'Phases, groups, tags, path types & cinema mode',
    file: 'samples/medium.json',
    data: mediumData,
    nodeCount: '22 nodes',
  },
  {
    id: 'large',
    label: 'Cloud Migration Programme',
    description: 'Full-featured: 6 phases, 5 groups, 9 owners, complex topology',
    file: 'samples/large.json',
    data: largeData,
    nodeCount: '41 nodes',
  },
  {
    id: 'xlarge',
    label: 'Global Digital Transformation',
    description: '8 phases, 12 groups (nested), 16 owners, all edge types, cinema & heatmap ready',
    file: 'samples/xlarge.json',
    data: xlargeData,
    nodeCount: '200 nodes',
  },
];
