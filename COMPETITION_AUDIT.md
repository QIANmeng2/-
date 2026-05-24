# 赛事中心架构污染分析报告
## 2026-05-23 生成

---

## 1. 当前赛事页依赖树

```
页面加载 (index.html)
  └── (async) switchTab('competition')        ← 主入口
        ├── currentTab = 'competition'
        ├── Tracker.trackTabSwitch()           ← 埋点依赖
        ├── hero.style.display                 ← DOM 操作
        ├── competitionList.style.display       ← DOM 操作
        ├── updateUI()                         ← 全局 UI 刷新（auth/余额）
        ├── tabContent.innerHTML = spinner      ← 加载态
        └── loadMatches()                       ← 核心比赛逻辑
              ├── _tabVersion 读取              ← 竞态依赖 switchTab
              ├── api('/api/matches')           ← 网络（5min 缓存 + 2次重试）
              ├── api('/api/competitions')       ← 降级路径
              ├── competitionToMatch()           ← 数据适配器
              ├── window.MatchCard.renderList()  ← 组件依赖（可能缺失→兜底）
              ├── tabContent spinner.remove()    ← 清理 switchTab 残留
              └── catch → container.innerHTML    ← 错误渲染
```

---

## 2. 污染赛事中心的模块清单

| # | 模块 | 污染方式 | 严重度 |
|---|------|---------|--------|
| 1 | **switchTab()** | 门控所有赛事加载。修改 currentTab、调用 updateUI、控制 DOM 显示。如果 tabContent 不存在直接 return | 🔴 致命 |
| 2 | **updateUI()** | 每次 tab 切换触发。读取 currentUser 刷新登录态/金币/管理员按钮。赛事加载被迫在每次切换时重新执行 | 🔴 致命 |
| 3 | **auth/login 系统** | switchTab 在校验 currentUser 后拦截 tab。api() 在 401 时调用 logout()→switchTab('square') 打断赛事请求链 | 🟠 高危 |
| 4 | **loading spinner** | switchTab 写入 tabContent，loadMatches 手动清除。两个函数共享 DOM 导致状态不一致 | 🟠 高危 |
| 5 | **Tab 按钮事件** | `document.querySelectorAll('.tab-btn')` 绑定 onclick → switchTab。点击任何 tab 会中断赛事渲染 | 🟡 中危 |
| 6 | **Socket.IO 聊天** | chatSocket / chatCurrentType / chatUnreadCounts 全局变量。消息事件回调 `getElementById('chatMessages')` 在非聊天 tab 上返回 null | 🟡 中危 |
| 7 | **Tracker 埋点** | `Tracker.trackTabSwitch()` 在 switchTab 中被调用，tracker 初始化失败会抛 error（虽然有 catch） | 🟢 低危 |
| 8 | **OnboardingModal** | 页面初始化 1.2s 后 `autoOpenIfFirstTime()` → 弹窗覆盖赛事页 UI | 🟢 低危 |
| 9 | **ErrorBoundary** | 全局 `window.addEventListener('error')` 捕获所有 JS 异常，但仅拦截 `null.style` 类错误。赛事页的 TypeError 仍会冒泡 | 🟡 中危 |
| 10 | **`window._compCache`** | 赛事详情/报名逻辑通过 `window._compCache[id]` 读写缓存，与组件系统的 `_matchCache` 并存，双缓存不一致风险 | 🟡 中危 |

---

## 3. 循环依赖 & 状态死锁风险

### 3.1 switchTab ↔ loadMatches 竞态
```
switchTab('competition')
  → _tabVersion++ (set to N)
  → loadMatches()
    → 读取 _tabVersion (N)
    → await api('/api/matches') ... 耗时 2s
    → 用户点了 square tab
      → switchTab('square') → _tabVersion++ (N+1)
    → loadMatches 返回
    → if (_tabVersion !== N) return;  ← 丢弃结果！
```
**后果**：快速切 tab 时赛事列表永远不渲染。

### 3.2 updateUI → switchTab 链
```
更新用户信息 → updateUI() → 金币显示刷新
  → 如果失败 → 不直接崩溃
  → 但如果 updateUI 中任何 DOM 操作抛异常 → 阻塞 switchTab
```

### 3.3 logout → api → 赛事链断裂
```
赛事报名 POST /api/matches/:id/participants
  → 返回 401
  → api() 内 catch → logout()
  → logout() → switchTab('square') → 销毁竞争列表 DOM
  → 原报名流程的后续 UI 操作指向已销毁 DOM → null error
```

### 3.4 双缓存矛盾
```
loadMatches() → _matchCache[id] = match
openCompetitionDetail() → window._compCache[id] = comp
```
两份缓存内容格式不同（Match 模型 vs Competition 模型），局部刷新时可能读到错误模型。

---

## 4. WebSocket 消息导致赛事页崩溃的风险点

| 消息事件 | 风险描述 | 触发条件 |
|---------|---------|---------|
| `new_message` | 调用 chatMessageCallbacks。如果其中某个 callback 引用了赛事页 DOM（已因为切 tab 销毁），则 TypeError | 用户在赛事页停留时收到聊天消息 |
| `message_recalled` | `getElementById('chatMessages')` → null → `.innerHTML` 报错（虽然有 if(!container) return 保护） | 当前安全 |
| `user_muted` | `showToast()` + `currentUser?.id`。如果 currentUser 未初始化则无害 | 低风险 |
| `authenticated` | 赛后重建连接时触发，写 console.log | 无害 |
| `timelineAdded` (server 端广播) | **注意：仅在 server.js 通过 `io.emit` 广播**。前端未监听此事件，当前无影响 | 暂无风险 |

---

## 5. 已执行的隔离措施

| 措施 | 状态 |
|------|------|
| ✅ 创建 `competition.html` 独立页 | 完成 |
| ✅ 独立路由 `/competition.html` | 已部署 |
| ✅ 独立 state（IIFE 闭包，不读 window.xxx） | 完成 |
| ✅ 独立 fetch（无缓存、无重试、无 auth） | 完成 |
| ✅ 零依赖：不依赖聊天/websocket/tab/通知/auth/onboarding/loading | 完成 |
| ✅ 页面只做：打开→请求API→渲染列表 | 完成 |
| ⬜ 禁止赛事中心读取 window.xxx | **需重构 app.js** |
| ⬜ 禁止依赖聊天频道状态 | **需重构 app.js** |
| ⬜ 模块独立初始化 | **需重构 app.js** |
| ⬜ 关闭实时推送/聊天联动/复杂tab/自动频道切换/通知联动 | **需重构 app.js** |

---

## 6. 下一步建议

1. **访问 `https://neondream.cn/competition.html`** 验证隔离页是否稳定加载
2. 稳定后，将 competition.html 作为赛事中心的**唯一入口**
3. 从 app.js 中**删除** `switchTab('competition')` 路径，改为 `<a href="/competition.html">`
4. 逐步在 competition.html 上恢复高级功能（一次一个，验证稳定后再加下一个）
