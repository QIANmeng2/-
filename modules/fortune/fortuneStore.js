// fortuneStore.js — 每日卜卦状态管理
// IIFE 暴露 window.FortuneStore

(function () {
  'use strict';

  var _state = {
    status: 'loading',     // 'loading' | 'unclaimed' | 'claimed' | 'error'
    fortuneType: '',       // 'great' | 'good' | 'fair' | 'bad' | 'terrible'
    fortuneText: '',
    reward: 0,
    newBalance: 0
  };

  var _listeners = [];

  function _notify() {
    _listeners.forEach(function (fn) {
      try { fn(_state); } catch (e) { /* ignore */ }
    });
  }

  var FortuneStore = {
    /** 获取当前状态快照 */
    getState: function () {
      return Object.assign({}, _state);
    },

    /** 订阅状态变更 */
    subscribe: function (fn) {
      _listeners.push(fn);
      return function () {
        _listeners = _listeners.filter(function (f) { return f !== fn; });
      };
    },

    /** 初始化：从服务器获取今日状态 */
    init: async function () {
      if (!window.FortuneAPI) {
        _state.status = 'error';
        _notify();
        return;
      }
      _state.status = 'loading';
      _notify();

      try {
        var data = await window.FortuneAPI.getStatus();
        if (!data) {
          _state.status = 'error';
          _notify();
          return;
        }
        if (data.claimed_today) {
          _state.status = 'claimed';
          _state.fortuneType = data.fortune_type || '';
          _state.fortuneText = data.fortune_text || '';
          _state.reward = data.reward || 0;
        } else {
          _state.status = 'unclaimed';
        }
      } catch (e) {
        _state.status = 'error';
      }
      _notify();
    },

    /** 执行卜卦 */
    draw: async function () {
      if (_state.status !== 'unclaimed') return;
      _state.status = 'loading';
      _notify();

      try {
        var data = await window.FortuneAPI.draw();
        _state.status = 'claimed';
        _state.fortuneType = data.fortune_type;
        _state.fortuneText = data.fortune_text;
        _state.reward = data.reward;
        _state.newBalance = data.newBalance;
        _notify();
        return data;
      } catch (e) {
        _state.status = 'unclaimed'; // 回退
        _notify();
        throw e;
      }
    }
  };

  window.FortuneStore = FortuneStore;
})();
