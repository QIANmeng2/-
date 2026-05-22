/**
 * competitionStore.js — 赛事模块状态管理
 * 
 * 设计原则：
 * - 纯 IIFE 闭包，不接触 window（除调试暴露）
 * - 禁止 window._compCache / globalState / currentUser
 * - 单一数据源，所有状态变更经 setState()
 */

;(function() {
  'use strict';

  // ===== State =====
  var state = {
    matches: [],          // 赛事列表（原始数据）
    filtered: [],        // 过滤后列表
    loading: false,
    error: null,
    filter: {
      mode: '',          // '' | 'training' | 'regular' | 'arena'
      status: '',        // '' | 'CREATED' | 'REGISTERING' | ...
      search: ''         // 搜索关键词
    },
    sort: 'start_time', // 排序字段
    sortDir: 'desc'      // 'asc' | 'desc'
  };

  // ===== 状态变更（唯一出口）=====
  function setState(next) {
    var key = null;
    for (key in next) {
      if (Object.prototype.hasOwnProperty.call(state, key)) {
        state[key] = next[key];
      }
    }
    // 触发渲染（由 View 层注册回调）
    if (typeof _onStateChange === 'function') {
      _onStateChange(state);
    }
  }

  // ===== 渲染回调（由 View 层注入）=====
  var _onStateChange = null;
  function onStateChange(fn) {
    _onStateChange = fn;
  }

  // ===== 数据设置 =====
  function setMatches(data) {
    var list = data.matches || data || [];
    setState({
      matches: list,
      filtered: _applyFilter(list, state.filter),
      loading: false,
      error: null
    });
  }

  function setLoading(v) {
    setState({ loading: v });
  }

  function setError(msg) {
    setState({ error: msg, loading: false });
  }

  // ===== 过滤 + 排序 =====
  function _applyFilter(list, filter) {
    var result = list.slice();
    if (filter.mode) {
      result = result.filter(function(m) { return m.mode === filter.mode; });
    }
    if (filter.status) {
      result = result.filter(function(m) { return (m.status || '').toUpperCase() === filter.status; });
    }
    if (filter.search) {
      var kw = filter.search.toLowerCase();
      result = result.filter(function(m) {
        var t = (m.title || m.name || '').toLowerCase();
        return t.indexOf(kw) !== -1;
      });
    }
    return result;
  }

  function setFilter(nextFilter) {
    var filter = {};
    var k = null;
    for (k in state.filter) { filter[k] = state.filter[k]; }
    for (k in nextFilter) { if (Object.prototype.hasOwnProperty.call(nextFilter, k)) filter[k] = nextFilter[k]; }
    var filtered = _applyFilter(state.matches, filter);
    setState({ filter: filter, filtered: filtered });
  }

  function toggleSort(field) {
    var dir = (state.sort === field && state.sortDir === 'asc') ? 'desc' : 'asc';
    var list = state.filtered.slice().sort(function(a, b) {
      var va = a[field], vb = b[field];
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return dir === 'asc' ? (va - vb) : (vb - va);
    });
    setState({ sort: field, sortDir: dir, filtered: list });
  }

  // ===== 只读访问 =====
  function getState() {
    return state;
  }

  // ===== 暴露（仅调试用）=====
  window.CompetitionStore = {
    getState: getState,
    setMatches: setMatches,
    setLoading: setLoading,
    setError: setError,
    setFilter: setFilter,
    toggleSort: toggleSort,
    onStateChange: onStateChange
  };

})();
