import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Element Intent',
    description: '选择网页元素并复制一段可交给 AI 编程工具的修改说明。',
    permissions: ['activeTab', 'scripting'],
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: '开启或关闭元素标注模式',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
      },
    },
  },
});
