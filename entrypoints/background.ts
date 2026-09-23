import type { ScriptPublicPath } from 'wxt/utils/inject-script';

// Chrome expects a path relative to the extension root. WXT's generated
// public-path type includes a leading slash, so keep the runtime value relative
// and narrow it only for the API type.
const ANNOTATOR_SCRIPT = 'content-scripts/annotator.js' as unknown as ScriptPublicPath;

export default defineBackground(() => {
  browser.action.onClicked.addListener(async (tab) => {
    if (tab.id == null) return;

    try {
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: [ANNOTATOR_SCRIPT],
      });
      await browser.action.setTitle({
        tabId: tab.id,
        title: '开启或关闭元素标注模式',
      });
      await browser.action.setBadgeText({ tabId: tab.id, text: '' });
    } catch (error) {
      console.warn('Element Intent cannot run on this page.', error);
      const message = error instanceof Error ? error.message : String(error);
      await browser.action.setTitle({
        tabId: tab.id,
        title: `无法在此页面运行：${message}`,
      });
      await browser.action.setBadgeBackgroundColor({
        tabId: tab.id,
        color: '#DC2626',
      });
      await browser.action.setBadgeText({ tabId: tab.id, text: '!' });
    }
  });
});
