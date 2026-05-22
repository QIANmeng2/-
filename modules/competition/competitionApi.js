/**
 * competitionApi.js — 赛事 API 独立调用层（含旧数据兼容层）
 *
 * 设计原则：
 * - 优先 /api/matches（新架构）
 * - 为空时自动 fallback 到 /api/competitions（旧数据）
 * - 字段映射在 Api 层完成，View/Store 无感
 * - 禁止修改 competitionView.js / competitionStore.js / app.js
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

  // ===== 字段映射：旧 competitions → 统一 matches 结构 =====
  function mapLegacyCompetition(c) {
    return {
      id:        c.id,
      title:     c.name || c.title || '未命名赛事',
      status:    (c.comp_status || c.status || 'CREATED').toUpperCase(),
      mode:      (c.tier  || c.mode  || 'training').toLowerCase(),
      startTime: c.start_time || c.startTime || null,
      bo:        c.bo || c.bo || 3,
      // 旧数据没有 teams 结构，用创建者占位
      teams:     c.teams || null,
      creatorName: c.created_by_name || c.created_by_username || '',
      // 保留旧字段供 View 层可选使用
      _legacy:   true
    };
  }

  // ===== 获取赛事列表（含兼容层）=====
  function fetchMatches() {
    var usedFallback = false;

    return request('/api/matches')
      .then(function(res) {
        var data = res.success !== undefined ? (res.matches || res.data || []) : (res.matches || res);
        if (Array.isArray(data) && data.length > 0) return { matches: data, _from: 'matches' };
        // 空数组 → 触发 fallback
        throw new Error('empty');
      })
      .catch(function() {
        console.log('[Competition] fallback to legacy competitions API');
        usedFallback = true;
        return request('/api/competitions').then(function(res) {
          var list = res.competitions || res.matches || res.data || res || [];
          if (!Array.isArray(list)) list = [];
          var mapped = list.map(mapLegacyCompetition);
          return { matches: mapped, _from: 'competitions' };
        });
      });
  }

  // ===== 获取单场赛事详情 =====
  function fetchMatch(id) {
    return request('/api/matches/' + encodeURIComponent(id))
      .catch(function() {
        return request('/api/competitions/' + encodeURIComponent(id))
          .then(function(res) {
            var c = res.competition || res.data || res;
            return { match: mapLegacyCompetition(c) };
          });
      });
  }

  // ===== 获取赛程（时间线）=====
  function fetchSchedules() {
    return request('/api/matches?schedules=1')
      .catch(function() {
        return request('/api/competitions?schedules=1');
      });
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
