/**
 * competitionApi.js — 赛事 API 独立调用层
 *
 * 设计原则：
 * - 无缓存、无重试、无 auth（纯公开读接口）
 * - 超时 15s（AbortSignal）
 * - 不解包业务逻辑，只做 HTTP + JSON 解析
 * - 错误原样抛出，由调用方处理
 */

;(function() {
  'use strict';

  var API_BASE = 'https://perpetual-enchantment-production-b163.up.railway.app';

  // ===== 通用 fetch 封装 =====
  function request(path, options) {
    var url = API_BASE + path;
    var defaultOpts = {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000)
    };
    var opts = {};
    var key = null;
    for (key in defaultOpts) { opts[key] = defaultOpts[key]; }
    if (options) { for (key in options) { if (Object.prototype.hasOwnProperty.call(options, key)) opts[key] = options[key]; } }
    return fetch(url, opts).then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (res.statusText || ''));
      return res.json();
    });
  }

  // ===== 获取赛事列表 =====
  // 优先 /api/matches，降级 /api/competitions
  function fetchMatches() {
    return request('/api/matches').catch(function() {
      return request('/api/competitions');
    });
  }

  // ===== 获取单场赛事详情 =====
  function fetchMatch(id) {
    return request('/api/matches/' + encodeURIComponent(id));
  }

  // ===== 获取赛程（时间线）=====
  function fetchSchedules() {
    return request('/api/matches?schedules=1');
  }

  // ===== 创建赛事（管理员）=====
  function createCompetition(payload) {
    return request('/api/admin/competitions', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  // ===== 删除赛事（管理员）=====
  function deleteCompetition(id) {
    return request('/api/admin/competitions/' + encodeURIComponent(id), {
      method: 'DELETE'
    });
  }

  // ===== 暴露 =====
  window.CompetitionApi = {
    fetchMatches: fetchMatches,
    fetchMatch: fetchMatch,
    fetchSchedules: fetchSchedules,
    createCompetition: createCompetition,
    deleteCompetition: deleteCompetition
  };

})();
