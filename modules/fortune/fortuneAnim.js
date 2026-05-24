// fortuneAnim.js — 卜卦轻量动画
// IIFE 暴露 window.FortuneAnim

(function () {
  'use strict';

  /**
   * 播放卜卦动画
   * @param {HTMLElement} container - 卜卦卡片容器
   * @returns {Promise<void>} 动画完成
   */
  var FortuneAnim = {
    play: function (container) {
      return new Promise(function (resolve) {
        if (!container) { resolve(); return; }

        // 找到按钮并隐藏
        var btn = container.querySelector('.fortune-btn');
        if (btn) {
          btn.style.transition = 'all 0.3s ease';
          btn.style.opacity = '0';
          btn.style.transform = 'scale(0.8)';
        }

        // 找到图标环，旋转
        var ring = container.querySelector('.fortune-icon-ring');
        if (ring) {
          ring.style.transition = 'transform 0.6s ease-in-out';
          ring.style.transform = 'rotate(360deg)';
        }

        // 标题渐隐
        var title = container.querySelector('.fortune-title');
        if (title) {
          title.style.transition = 'opacity 0.3s ease';
          title.style.opacity = '0';
        }

        // 副标题闪烁
        var subtitle = container.querySelector('.fortune-subtitle');
        var hint = container.querySelector('.fortune-hint');
        if (subtitle) {
          subtitle.style.transition = 'opacity 0.15s ease';
        }
        if (hint) {
          hint.style.transition = 'opacity 0.15s ease';
        }

        // 闪烁 3 次
        var flashes = 0;
        var maxFlashes = 3;
        var flashInterval = setInterval(function () {
          flashes++;
          if (flashes <= maxFlashes) {
            if (subtitle) subtitle.style.opacity = (flashes % 2 === 0) ? '1' : '0.2';
            if (hint) hint.style.opacity = (flashes % 2 === 0) ? '1' : '0.2';
          } else {
            clearInterval(flashInterval);
            // 动画完成
            setTimeout(function () {
              // 恢复样式
              if (ring) { ring.style.transform = ''; }
              if (title) { title.style.opacity = ''; }
              if (subtitle) { subtitle.style.opacity = ''; }
              if (hint) { hint.style.opacity = ''; }
              resolve();
            }, 200);
          }
        }, 300);
      });
    }
  };

  window.FortuneAnim = FortuneAnim;
})();
