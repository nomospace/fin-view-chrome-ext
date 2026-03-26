// content.js - FinView 财经内容 AI 解读
// 选中文字 → 弹出 AI 解读按钮 → 点击解读 → 结果显示在原文下方

(function() {
  'use strict';

  // ==================== 配置 ====================
  const CONFIG = {
    minTextLength: 10,
  };

  // ==================== Markdown 解析 ====================
  function parseMarkdown(text) {
    if (!text) return '';
    
    // 转义 HTML
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // 标题
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    
    // 加粗和斜体
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');
    
    // 代码块
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // 列表
    html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    
    // 包装连续的 li 为 ul
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    
    // 引用
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    
    // 分隔线
    html = html.replace(/^---$/gm, '<hr>');
    html = html.replace(/^\*\*\*$/gm, '<hr>');
    
    // 段落和换行
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    
    // 包装
    html = '<p>' + html + '</p>';
    
    // 清理空段落
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<p>\s*<(h[1-6]|ul|ol|pre|blockquote|hr)/g, '<$1');
    html = html.replace(/<\/(h[1-6]|ul|ol|pre|blockquote)>\s*<\/p>/g, '</$1>');
    
    return html;
  }

  // ==================== 状态 ====================
  let apiKey = null;
  let selectionButton = null;
  let savedSelection = null;
  let isLoading = false;
  let resultId = 0; // 用于生成唯一 ID

  // ==================== 加载 API Key ====================
  async function loadApiKey() {
    if (apiKey) return apiKey;
    
    return new Promise((resolve) => {
      chrome.storage.local.get(['finview_apikey'], (result) => {
        if (result.finview_apikey) {
          apiKey = result.finview_apikey;
          resolve(apiKey);
        } else {
          resolve(null);
        }
      });
    });
  }

  // ==================== 文本选择监听 ====================
  document.addEventListener('mouseup', (e) => {
    if (e.target.closest('#finview-btn') || e.target.closest('.finview-result')) {
      return;
    }

    setTimeout(() => {
      const selection = window.getSelection();
      
      if (!selection || selection.rangeCount === 0) {
        hideButton();
        return;
      }

      const text = selection.toString().trim();

      if (text && text.length >= CONFIG.minTextLength) {
        try {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          
          savedSelection = text;
          
          showButton(rect);
        } catch (e) {
          hideButton();
        }
      } else {
        savedSelection = null;
        hideButton();
      }
    }, 50);
  });

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#finview-btn') && !e.target.closest('.finview-dialog')) {
      hideButton();
      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (!text || text.length < CONFIG.minTextLength) {
          savedSelection = null;
        }
      }, 100);
    }
  });

  window.addEventListener('scroll', hideButton, { passive: true });

  // ==================== UI 组件 ====================
  function showButton(rect) {
    hideButton();

    selectionButton = document.createElement('div');
    selectionButton.id = 'finview-btn';
    selectionButton.innerHTML = `
      <span class="finview-btn-icon">🦞</span>
      <span class="finview-btn-text">AI 解读</span>
    `;

    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

    let left = rect.right + scrollLeft + 10;
    let top = rect.top + scrollTop - 5;

    if (left + 120 > window.innerWidth + scrollLeft) {
      left = rect.left + scrollLeft - 130;
    }
    if (top < scrollTop + 10) {
      top = rect.bottom + scrollTop + 10;
    }

    selectionButton.style.left = `${left}px`;
    selectionButton.style.top = `${top}px`;

    selectionButton.addEventListener('click', handleInterpret);
    document.body.appendChild(selectionButton);
  }

  function hideButton() {
    if (selectionButton) {
      selectionButton.remove();
      selectionButton = null;
    }
  }

  function showLoading() {
    resultId++;
    const currentId = `finview-dialog-${resultId}`;

    const dialog = document.createElement('div');
    dialog.className = 'finview-dialog finview-loading';
    dialog.id = currentId;
    dialog.innerHTML = `
      <div class="finview-loading-inner">
        <span class="finview-spinner"></span>
        <span>AI 解读中...</span>
      </div>
    `;

    centerDialog(dialog);
    document.body.appendChild(dialog);
    
    return currentId;
  }

  function showResult(content) {
    resultId++;
    const currentId = `finview-dialog-${resultId}`;

    const dialog = document.createElement('div');
    dialog.className = 'finview-dialog';
    dialog.id = currentId;
    dialog.innerHTML = `
      <div class="finview-header">
        <span class="finview-logo">🦞</span>
        <span class="finview-title">AI 解读</span>
        <button class="finview-close" title="关闭">✕</button>
      </div>
      <div class="finview-content">${parseMarkdown(content)}</div>
    `;

    centerDialog(dialog);
    document.body.appendChild(dialog);
    
    // 绑定关闭按钮
    dialog.querySelector('.finview-close').addEventListener('click', () => {
      dialog.remove();
    });
    
    // 按住拖动
    makeDraggable(dialog);
  }

  function showError(message) {
    resultId++;
    const currentId = `finview-dialog-${resultId}`;
    
    let errorTitle = '解读失败';
    if (message.includes('配置 API Key')) {
      errorTitle = '未配置';
    }
    
    const dialog = document.createElement('div');
    dialog.className = 'finview-dialog finview-error';
    dialog.id = currentId;
    dialog.innerHTML = `
      <div class="finview-header">
        <span class="finview-logo">🦞</span>
        <span class="finview-title">${errorTitle}</span>
        <button class="finview-close" title="关闭">✕</button>
      </div>
      <div class="finview-content">
        <div class="finview-error-detail">${escapeHtml(message)}</div>
      </div>
    `;

    centerDialog(dialog);
    document.body.appendChild(dialog);
    
    // 绑定关闭按钮
    dialog.querySelector('.finview-close').addEventListener('click', () => {
      dialog.remove();
    });
    
    makeDraggable(dialog);
    console.error('[FinView]', message);
  }

  function centerDialog(dialog) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    dialog.style.left = `${(viewportWidth - 500) / 2}px`;
    dialog.style.top = `${Math.max(50, (viewportHeight - 400) / 2)}px`;
  }

  function makeDraggable(dialog) {
    const header = dialog.querySelector('.finview-header');
    if (!header) return;
    
    let isDragging = false;
    let startX, startY, startLeft, startTop;
    
    header.style.cursor = 'move';
    
    header.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('finview-close')) return;
      
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = dialog.offsetLeft;
      startTop = dialog.offsetTop;
      
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      
      dialog.style.left = `${Math.max(0, startLeft + dx)}px`;
      dialog.style.top = `${Math.max(0, startTop + dy)}px`;
    });
    
    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
  }

  // ==================== AI 请求 ====================
  async function handleInterpret() {
    if (isLoading) return;

    const text = savedSelection;

    if (!text) {
      return;
    }

    hideButton();
    isLoading = true;

    const loadingId = showLoading();

    try {
      const key = await loadApiKey();
      
      if (!key) {
        document.getElementById(loadingId)?.remove();
        showError('请点击扩展图标配置 API Key');
        return;
      }
      
      // 通过 background.js 调用 API（绕过 CORS）
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: 'callAI', content: text, apiKey: key },
          (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(result);
            }
          }
        );
      });
      
      // 移除 loading
      document.getElementById(loadingId)?.remove();
      
      if (!response.success) {
        showError(response.error || 'AI 调用失败');
      } else {
        showResult(response.result);
      }
    } catch (e) {
      document.getElementById(loadingId)?.remove();
      showError(e.message);
    } finally {
      isLoading = false;
    }
  }

})();