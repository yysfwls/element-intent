// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnnotator } from './annotator';

vi.mock('@floating-ui/dom', () => ({
  autoUpdate: (_reference: Element, _floating: HTMLElement, update: () => void) => {
    update();
    return vi.fn();
  },
  computePosition: vi.fn().mockResolvedValue({ x: 10, y: 10 }),
  flip: () => ({ name: 'flip' }),
  offset: () => ({ name: 'offset' }),
  shift: () => ({ name: 'shift' }),
}));

function makeVisible(element: HTMLElement) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    value: () => ({
      width: 100,
      height: 40,
      top: 0,
      left: 0,
      right: 100,
      bottom: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}

function findButton(root: ShadowRoot, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (!button) throw new Error(`找不到按钮：${text}`);
  return button;
}

function addAnnotation(root: ShadowRoot, element: HTMLElement, intent: string) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const input = root.querySelector('textarea');
  if (!input) throw new Error('找不到修改意图输入框');
  input.value = intent;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  findButton(root, '添加').click();
}

describe('annotator interactions', () => {
  let root: ShadowRoot;
  let controller: ReturnType<typeof createAnnotator> | null;
  let writeText: ReturnType<typeof vi.fn>;
  let restoreAttachShadow: () => void;

  beforeEach(() => {
    document.body.innerHTML = '';
    history.replaceState({}, '', '/editor');
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const nativeAttachShadow = HTMLElement.prototype.attachShadow;
    const spy = vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(function (
      this: HTMLElement,
      init,
    ) {
      root = nativeAttachShadow.call(this, { ...init, mode: 'open' });
      return root;
    });
    restoreAttachShadow = () => spy.mockRestore();
    controller = null;
  });

  afterEach(() => {
    controller?.stop();
    document.getElementById('element-intent-extension-root')?.remove();
    restoreAttachShadow();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('adds, edits, deletes and copies multiple annotations', async () => {
    document.body.innerHTML = `
      <main>
        <button data-testid="save">保存</button>
        <h2>旧标题</h2>
      </main>
    `;
    const saveButton = document.querySelector('button') as HTMLElement;
    const heading = document.querySelector('h2') as HTMLElement;
    makeVisible(saveButton);
    makeVisible(heading);

    controller = createAnnotator();
    controller.start();
    addAnnotation(root, saveButton, '改成黑色');
    addAnnotation(root, heading, '改成新标题');

    expect(root.querySelectorAll('.marker')).toHaveLength(2);
    expect(root.querySelector('.toolbar')?.textContent).toContain('已标注 2 处');

    (root.querySelector('.marker') as HTMLButtonElement).click();
    const input = root.querySelector('textarea') as HTMLTextAreaElement;
    input.value = '改成白色';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    findButton(root, '更新').click();

    findButton(root, '复制给 AI').click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const copiedPrompt = writeText.mock.calls[0]?.[0] as string;
    expect(copiedPrompt).toContain('改成白色');
    expect(copiedPrompt).toContain('改成新标题');
    expect(copiedPrompt).not.toContain('改成黑色');

    (root.querySelector('.marker') as HTMLButtonElement).click();
    findButton(root, '删除').click();
    expect(root.querySelectorAll('.marker')).toHaveLength(1);

    findButton(root, '清空').click();
    expect(root.querySelectorAll('.marker')).toHaveLength(0);
    expect((root.querySelector('.toolbar') as HTMLElement).style.display).toBe('none');
  });

  it('keeps current-page annotations across stop and start', () => {
    document.body.innerHTML = '<button>保存</button>';
    const saveButton = document.querySelector('button') as HTMLElement;
    makeVisible(saveButton);

    controller = createAnnotator();
    controller.start();
    addAnnotation(root, saveButton, '改成黑色');
    controller.stop();
    controller.start();

    expect(root.querySelectorAll('.marker')).toHaveLength(1);
    expect((root.querySelector('.toolbar') as HTMLElement).style.display).toBe('flex');
  });

  it('removes stale annotations before copying after SPA navigation', async () => {
    document.body.innerHTML = '<button>保存</button>';
    const saveButton = document.querySelector('button') as HTMLElement;
    makeVisible(saveButton);

    controller = createAnnotator();
    controller.start();
    addAnnotation(root, saveButton, '改成黑色');
    (root.querySelector('.marker') as HTMLButtonElement).click();
    history.pushState({}, '', '/another-page');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect((root.querySelector('.panel') as HTMLElement).style.display).toBe('none');
    findButton(root, '复制给 AI').click();
    await vi.waitFor(() => expect(root.querySelectorAll('.marker')).toHaveLength(0));
    expect(writeText).not.toHaveBeenCalled();
    expect((root.querySelector('.toolbar') as HTMLElement).style.display).toBe('none');
  });
});
