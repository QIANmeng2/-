// fortuneApi.js — 每日卜卦 API 调用
// IIFE 暴露 window.FortuneAPI

(function () {
  'use strict';

  var FortuneAPI = {
    /**
     * 查询今日卜卦状态
     * @returns {Promise<{claimed_today: boolean, fortune_type?: string, fortune_text?: string, reward?: number}>}
     */
    getStatus: async function () {
      try {
        var token = (typeof authToken !== 'undefined' && authToken) ? authToken : (localStorage.getItem('token') || '');
        var res = await fetch('/api/me/daily-fortune', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        var data = await res.json();
        if (data.success) return data.data;
        throw new Error(data.message || '查询失败');
      } catch (e) {
        console.error('[FortuneAPI] getStatus:', e);
        return null;
      }
    },

    /**
     * 执行卜卦
     * @returns {Promise<{fortune_type: string, fortune_text: string, reward: number, newBalance: number}>}
     */
    draw: async function () {
        var token = (typeof authToken !== 'undefined' && authToken) ? authToken : (localStorage.getItem('token') || '');
        var res = await fetch('/api/me/daily-fortune', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        }
      });
      var data = await res.json();
      if (data.success) return data.data;
      throw new Error(data.message || '卜卦失败');
    }
  };

  window.FortuneAPI = FortuneAPI;
})();
