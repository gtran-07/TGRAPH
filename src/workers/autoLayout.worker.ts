import type { AutoLayoutInput, AutoLayoutOutput } from '../utils/autoLayout/index';
import { autoLayout } from '../utils/autoLayout/index';

export type WorkerInMessage = AutoLayoutInput;

export type WorkerOutMessage =
  | { type: 'progress'; phase: string }
  | { type: 'done'; positions: AutoLayoutOutput }
  | { type: 'error'; message: string };

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  try {
    const input = event.data;

    const inputWithProgress: AutoLayoutInput = {
      ...input,
      onProgress: (phase: string) => {
        const msg: WorkerOutMessage = { type: 'progress', phase };
        self.postMessage(msg);
      },
    };

    const positions = autoLayout(inputWithProgress);

    const done: WorkerOutMessage = { type: 'done', positions };
    self.postMessage(done);
  } catch (err) {
    const msg: WorkerOutMessage = {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(msg);
  }
};
