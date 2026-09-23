import { createAnnotator } from '../../src/annotator';

const CONTROLLER_KEY = '__elementIntentAnnotator__';

type AnnotatorGlobal = typeof globalThis & {
  [CONTROLLER_KEY]?: ReturnType<typeof createAnnotator>;
};

export default defineContentScript({
  registration: 'runtime',
  noScriptStartedPostMessage: true,
  main() {
    const globalState = globalThis as AnnotatorGlobal;
    const existing = globalState[CONTROLLER_KEY];

    if (existing) {
      existing.toggle();
      return;
    }

    const annotator = createAnnotator();
    globalState[CONTROLLER_KEY] = annotator;
    annotator.start();
  },
});
