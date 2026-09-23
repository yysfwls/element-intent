import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
} from '@floating-ui/dom';
import {
  buildCandidateChain,
  buildMultiAiPrompt,
  getPageContextKey,
  recommendedCandidateIndex,
} from './element-context';

type Mode = 'idle' | 'selecting' | 'locked';

interface Annotation {
  id: number;
  element: HTMLElement;
  intent: string;
  pageKey: string;
  marker: HTMLButtonElement;
  stopTracking: (() => void) | null;
}

const HOST_ID = 'element-intent-extension-root';

const styles = `
  :host, * { box-sizing: border-box; }
  .highlight {
    position: fixed;
    display: none;
    border: 2px solid #5b5cf0;
    border-radius: 4px;
    background: rgb(91 92 240 / 8%);
    box-shadow: 0 0 0 1px rgb(255 255 255 / 80%);
    pointer-events: none;
  }
  .panel {
    position: fixed;
    display: none;
    width: 160px;
    padding: 7px;
    border: 1px solid rgb(15 23 42 / 12%);
    border-radius: 6px;
    background: #ffffff;
    box-shadow: 0 8px 20px rgb(15 23 42 / 20%);
    color: #111827;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    pointer-events: auto;
  }
  textarea {
    display: block;
    width: 100%;
    min-height: 52px;
    resize: vertical;
    padding: 5px 6px;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    outline: none;
    background: #fff;
    color: #0f172a;
    font: inherit;
  }
  textarea:focus {
    border-color: #5b5cf0;
    box-shadow: 0 0 0 3px rgb(91 92 240 / 14%);
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    margin-top: 6px;
  }
  .cancel, .delete, .primary, .toolbar-button {
    min-height: 24px;
    padding: 0 8px;
    border-radius: 4px;
    cursor: pointer;
    font: 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .cancel {
    border: 1px solid #dbe2ea;
    background: #fff;
    color: #334155;
  }
  .cancel:hover { background: #f8fafc; }
  .delete {
    margin-right: auto;
    border: 1px solid #fecaca;
    background: #fff;
    color: #b91c1c;
  }
  .delete:hover { background: #fef2f2; }
  .primary {
    border: 1px solid #4f46e5;
    background: #4f46e5;
    color: #fff;
    font-weight: 650;
  }
  .primary:hover:not(:disabled) { background: #4338ca; }
  .primary:disabled { cursor: default; opacity: .45; }
  .marker {
    position: fixed;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 1px solid #fff;
    border-radius: 999px;
    background: #4f46e5;
    box-shadow: 0 2px 8px rgb(15 23 42 / 30%);
    color: #fff;
    cursor: pointer;
    font: 700 9px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    pointer-events: auto;
  }
  .marker:hover { background: #4338ca; transform: scale(1.08); }
  .toolbar {
    position: fixed;
    right: 12px;
    bottom: 12px;
    display: none;
    align-items: center;
    gap: 5px;
    padding: 6px;
    border: 1px solid rgb(15 23 42 / 12%);
    border-radius: 7px;
    background: #fff;
    box-shadow: 0 8px 24px rgb(15 23 42 / 18%);
    color: #334155;
    font: 10px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    pointer-events: auto;
  }
  .toolbar-button {
    border: 1px solid #dbe2ea;
    background: #fff;
    color: #334155;
  }
  .toolbar-button:hover { background: #f8fafc; }
  .toolbar-copy {
    border-color: #4f46e5;
    background: #4f46e5;
    color: #fff;
    font-weight: 650;
  }
  .toolbar-copy:hover { background: #4338ca; }
  [hidden] { display: none !important; }
`;

function createButton(className: string, text: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  return button;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const fallback = document.createElement('textarea');
    fallback.value = text;
    fallback.style.position = 'fixed';
    fallback.style.opacity = '0';
    document.body.append(fallback);
    fallback.select();
    const copied = document.execCommand('copy');
    fallback.remove();
    if (!copied) throw new Error('无法写入剪贴板');
  }
}

export function createAnnotator() {
  let mode: Mode = 'idle';
  let host: HTMLDivElement | null = null;
  let shadowRoot: ShadowRoot | null = null;
  let highlight: HTMLDivElement | null = null;
  let panel: HTMLDivElement | null = null;
  let input: HTMLTextAreaElement | null = null;
  let deleteButton: HTMLButtonElement | null = null;
  let submitButton: HTMLButtonElement | null = null;
  let toolbar: HTMLDivElement | null = null;
  let toolbarLabel: HTMLSpanElement | null = null;
  let toolbarCopyButton: HTMLButtonElement | null = null;
  let candidates: HTMLElement[] = [];
  let candidateIndex = -1;
  let lockedPageKey: string | null = null;
  let editingAnnotationId: number | null = null;
  let nextAnnotationId = 1;
  const annotations: Annotation[] = [];
  let hoveredElement: HTMLElement | null = null;
  let stopAutoUpdate: (() => void) | null = null;
  let feedbackTimer: number | null = null;
  let documentObserver: MutationObserver | null = null;
  let previousCursor = '';

  const selectedElement = () => candidates[candidateIndex] ?? null;

  function setHighlight(element: HTMLElement | null) {
    if (!highlight) return;
    hoveredElement = element;
    if (!element || !element.isConnected) {
      highlight.style.display = 'none';
      return;
    }

    const rect = element.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  }

  async function updateLockedPosition() {
    const element = selectedElement();
    if (!element || !panel) return;
    setHighlight(element);
    const position = await computePosition(element, panel, {
      strategy: 'fixed',
      placement: 'right-start',
      middleware: [offset(10), flip(), shift({ padding: 10 })],
    });
    panel.style.left = `${position.x}px`;
    panel.style.top = `${position.y}px`;
  }

  function selectCandidate(nextIndex: number) {
    if (!candidates[nextIndex]) return;
    candidateIndex = nextIndex;
    stopAutoUpdate?.();
    const element = selectedElement();
    if (!element || !panel) return;
    stopAutoUpdate = autoUpdate(element, panel, updateLockedPosition);
  }

  function updateMarkerPosition(annotation: Annotation) {
    if (!annotation.element.isConnected) {
      annotation.marker.style.display = 'none';
      return;
    }
    const rect = annotation.element.getBoundingClientRect();
    annotation.marker.style.display = 'grid';
    annotation.marker.style.left = `${Math.max(0, rect.right - 9)}px`;
    annotation.marker.style.top = `${Math.max(0, rect.top - 9)}px`;
  }

  function startMarkerTracking(annotation: Annotation) {
    annotation.stopTracking?.();
    annotation.stopTracking = null;
    if (!annotation.element.isConnected || mode === 'idle') {
      annotation.marker.style.display = 'none';
      return;
    }
    annotation.stopTracking = autoUpdate(annotation.element, annotation.marker, () => {
      updateMarkerPosition(annotation);
    });
  }

  function refreshToolbar() {
    pruneInvalidAnnotations();
    const lockedElement = selectedElement();
    if (
      mode === 'locked'
      && (lockedPageKey !== getPageContextKey() || !lockedElement?.isConnected)
    ) {
      closePanel();
      return;
    }
    if (!toolbar || !toolbarLabel) return;
    toolbar.style.display = annotations.length > 0 && mode !== 'idle' ? 'flex' : 'none';
    toolbarLabel.textContent = `已标注 ${annotations.length} 处`;
    annotations.forEach((annotation, index) => {
      annotation.marker.textContent = String(index + 1);
      annotation.marker.setAttribute('aria-label', `编辑第 ${index + 1} 处标注`);
    });
  }

  function openAnnotation(annotation: Annotation) {
    if (mode === 'idle' || !panel || !input || !submitButton || !deleteButton) return;
    candidates = [annotation.element];
    candidateIndex = 0;
    lockedPageKey = annotation.pageKey;
    editingAnnotationId = annotation.id;
    mode = 'locked';
    panel.style.display = 'block';
    input.value = annotation.intent;
    submitButton.textContent = '更新';
    submitButton.disabled = false;
    deleteButton.hidden = false;
    selectCandidate(0);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function createAnnotation(element: HTMLElement, intent: string) {
    if (!shadowRoot) return;
    const marker = createButton('marker', String(annotations.length + 1));
    const annotation: Annotation = {
      id: nextAnnotationId++,
      element,
      intent,
      pageKey: getPageContextKey(),
      marker,
      stopTracking: null,
    };
    marker.addEventListener('click', () => openAnnotation(annotation));
    annotations.push(annotation);
    shadowRoot.append(marker);
    startMarkerTracking(annotation);
    refreshToolbar();
  }

  function removeAnnotation(annotation: Annotation) {
    discardAnnotation(annotation);
    refreshToolbar();
  }

  function discardAnnotation(annotation: Annotation) {
    annotation.stopTracking?.();
    annotation.marker.remove();
    const index = annotations.indexOf(annotation);
    if (index >= 0) annotations.splice(index, 1);
  }

  function pruneInvalidAnnotations() {
    const currentPageKey = getPageContextKey();
    for (let index = annotations.length - 1; index >= 0; index -= 1) {
      const annotation = annotations[index];
      if (!annotation) continue;
      if (!annotation.element.isConnected || annotation.pageKey !== currentPageKey) {
        discardAnnotation(annotation);
      }
    }
  }

  function clearAnnotations() {
    for (const annotation of annotations) {
      annotation.stopTracking?.();
      annotation.marker.remove();
    }
    annotations.length = 0;
    refreshToolbar();
  }

  function closePanel() {
    if (mode !== 'locked') return;
    stopAutoUpdate?.();
    stopAutoUpdate = null;
    candidates = [];
    candidateIndex = -1;
    lockedPageKey = null;
    if (panel) panel.style.display = 'none';
    if (input) input.value = '';
    editingAnnotationId = null;
    if (submitButton) {
      submitButton.textContent = '添加';
      submitButton.disabled = true;
    }
    if (deleteButton) deleteButton.hidden = true;
    mode = 'selecting';
    setHighlight(null);
    refreshToolbar();
  }

  function lockTarget(target: EventTarget | null) {
    candidates = buildCandidateChain(target);
    candidateIndex = recommendedCandidateIndex(candidates);
    if (candidateIndex < 0 || !panel || !input) return;

    editingAnnotationId = null;
    lockedPageKey = getPageContextKey();
    mode = 'locked';
    panel.style.display = 'block';
    input.value = '';
    if (submitButton) {
      submitButton.textContent = '添加';
      submitButton.disabled = true;
    }
    if (deleteButton) deleteButton.hidden = true;
    selectCandidate(candidateIndex);
    input.focus();
  }

  function isExtensionEvent(event: Event): boolean {
    return host ? event.composedPath().includes(host) : false;
  }

  function onPointerMove(event: PointerEvent) {
    if (mode !== 'selecting' || isExtensionEvent(event)) return;
    const chain = buildCandidateChain(event.target);
    const index = recommendedCandidateIndex(chain);
    setHighlight(chain[index] ?? null);
  }

  function blockPagePointer(event: PointerEvent) {
    if (mode !== 'selecting' || isExtensionEvent(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onClick(event: MouseEvent) {
    if (mode !== 'selecting' || isExtensionEvent(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    lockTarget(event.target);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || mode === 'idle') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (mode === 'locked') closePanel();
    else stop();
  }

  function mount() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });

    shadowRoot = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = styles;
    highlight = document.createElement('div');
    highlight.className = 'highlight';

    panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '元素修改意图');

    input = document.createElement('textarea');
    input.placeholder = '输入你的修改意图…';
    input.setAttribute('aria-label', '修改意图');

    const actions = document.createElement('div');
    actions.className = 'actions';
    deleteButton = createButton('delete', '删除');
    deleteButton.hidden = true;
    const cancelButton = createButton('cancel', '取消');
    submitButton = createButton('primary', '添加');
    submitButton.disabled = true;

    cancelButton.addEventListener('click', closePanel);
    deleteButton.addEventListener('click', () => {
      const annotation = annotations.find((item) => item.id === editingAnnotationId);
      if (annotation) removeAnnotation(annotation);
      closePanel();
    });
    input.addEventListener('input', () => {
      if (submitButton && input) submitButton.disabled = input.value.trim().length === 0;
    });
    submitButton.addEventListener('click', () => {
      const element = selectedElement();
      if (!element || !input || !submitButton || !input.value.trim()) return;
      const intent = input.value.trim();
      const annotation = annotations.find((item) => item.id === editingAnnotationId);
      if (annotation) {
        annotation.intent = intent;
      } else {
        createAnnotation(element, intent);
      }
      closePanel();
    });

    actions.append(deleteButton, cancelButton, submitButton);
    panel.append(input, actions);

    toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbarLabel = document.createElement('span');
    const clearButton = createButton('toolbar-button', '清空');
    toolbarCopyButton = createButton('toolbar-button toolbar-copy', '复制给 AI');
    clearButton.addEventListener('click', () => {
      if (mode === 'locked') closePanel();
      clearAnnotations();
    });
    toolbarCopyButton.addEventListener('click', async () => {
      refreshToolbar();
      if (!toolbarCopyButton || annotations.length === 0) return;
      toolbarCopyButton.disabled = true;
      try {
        await copyText(buildMultiAiPrompt(annotations));
        toolbarCopyButton.textContent = '已复制';
        if (feedbackTimer != null) window.clearTimeout(feedbackTimer);
        feedbackTimer = window.setTimeout(() => {
          if (!toolbarCopyButton) return;
          toolbarCopyButton.textContent = '复制给 AI';
          toolbarCopyButton.disabled = false;
        }, 1500);
      } catch {
        toolbarCopyButton.textContent = '复制失败';
        toolbarCopyButton.disabled = false;
      }
    });
    toolbar.append(toolbarLabel, clearButton, toolbarCopyButton);

    shadowRoot.append(style, highlight, panel, toolbar);
    document.documentElement.append(host);
  }

  function addListeners() {
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerdown', blockPagePointer, true);
    document.addEventListener('pointerup', blockPagePointer, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', refreshHighlight, true);
    window.addEventListener('resize', refreshHighlight);
    window.addEventListener('popstate', refreshToolbar);
    window.addEventListener('hashchange', refreshToolbar);
  }

  function removeListeners() {
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerdown', blockPagePointer, true);
    document.removeEventListener('pointerup', blockPagePointer, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', refreshHighlight, true);
    window.removeEventListener('resize', refreshHighlight);
    window.removeEventListener('popstate', refreshToolbar);
    window.removeEventListener('hashchange', refreshToolbar);
  }

  function refreshHighlight() {
    if (mode === 'selecting') setHighlight(hoveredElement);
  }

  function start() {
    if (mode !== 'idle') return;
    mount();
    if (host) host.style.display = 'block';
    mode = 'selecting';
    addListeners();
    documentObserver = new MutationObserver(refreshToolbar);
    documentObserver.observe(document.documentElement, { childList: true, subtree: true });
    annotations.forEach(startMarkerTracking);
    refreshToolbar();
    previousCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = 'crosshair';
  }

  function stop() {
    if (mode === 'idle') return;
    removeListeners();
    documentObserver?.disconnect();
    documentObserver = null;
    stopAutoUpdate?.();
    stopAutoUpdate = null;
    if (feedbackTimer != null) window.clearTimeout(feedbackTimer);
    feedbackTimer = null;
    for (const annotation of annotations) {
      annotation.stopTracking?.();
      annotation.stopTracking = null;
    }
    setHighlight(null);
    if (panel) panel.style.display = 'none';
    if (toolbar) toolbar.style.display = 'none';
    if (host) host.style.display = 'none';
    document.documentElement.style.cursor = previousCursor;
    candidates = [];
    candidateIndex = -1;
    lockedPageKey = null;
    mode = 'idle';
  }

  function toggle() {
    if (mode === 'idle') start();
    else stop();
  }

  return { start, stop, toggle };
}
