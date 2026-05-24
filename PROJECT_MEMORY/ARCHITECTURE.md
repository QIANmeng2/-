# ARCHITECTURE.md — 当前真实架构

> 更新时间：2026-05-25
> 读取时机：每次新开发前、架构调整后

---

## 一、目录结构

```
qianmeng-train/
├── server.js              # Express 后端（所有 API 路由）
├── app.js                 # 前端入口逻辑（路由守卫 + tab 调度）
├── index.html             # SPA 入口
├── styles.css             # 全局样式
├── components/            # 9 个核心 UI 组件（IIFE + window.Components）
│   ├── MatchStatusBadge.js
│   ├── MatchCard.js
│   ├── ScoreBoard.js
│   ├── Timeline.js
│   ├── MVPPanel.js
│   ├── PlayerList.js
│   ├── RegistrationPanel.js
│   ├── Tracker.js
│   └── OnboardingModal.js
├── modules/               # 业务模块（独立封装）
│   ├── auth/              # 认证模块
│   ├── chat/              # 聊天模块
│   ├── competition/       # 赛事模块
│   ├── fortune/           # 卜卦模块
│   ├── notification/      # 通知模块
│   └── socket/           # WebSocket 模块
├── PROJECT_MEMORY/        # 项目长期记忆（AI 上下文）
└── __tests__/            # Jest 集成测试
```

---

## 二、模块关系图

```
index.html
    │
    ├── app.js（入口调度）
    │     ├── switchTab()  → 加载对应模块
    │     ├── updateUI()   → 全局 UI 状态同步
    │     └── DOM 事件绑定
    │
    ├── modules/auth/        ← 独立
    │     ├── authApi.js       # API 调用
    │     ├── authGuard.js     # 路由守卫
    │     └── authStore.js    # 状态管理
    │
    ├── modules/competition/
    │     ├── competitionApi.js       # API
    │     ├── competitionStore.js     # 状态
    │     ├── competitionView.js      # UI 渲染
    │     ├── competitionPage.js      # 页面逻辑
    │     └── competitionLegacyBridge.js  # ← 与 app.js 的唯一桥接
    │
    ├── modules/chat/        ← 已独立化
    │     ├── chatApi.js
    │     ├── chatStore.js
    │     ├── chatView.js
    │     ├── chatPage.js
    │     └── chatRoomManager.js
    │
    ├── modules/socket/      ← 已独立化
    │     ├── socketManager.js
    │     ├── socketEvents.js
    │     ├── socketChannels.js
    │     └── socketReconnect.js
    │
    ├── modules/notification/  ← 已独立化
    │     ├── notifStore.js
    │     ├── notifView.js
    │     ├── notifQueue.js
    │     └── notifSocket.js
    │
    └── modules/fortune/    ← 已完成
          ├── fortuneApi.js
          ├── fortuneStore.js
          ├── fortuneView.js
          └── fortuneAnim.js
```

---

## 三、模块独立化状态

| 模块 | 状态 | 桥接文件 | 是否污染 app.js |
|------|------|----------|----------------|
| `auth/` | ✅ 独立 | 无（直接挂载） | 否 |
| `competition/` | ✅ 独立 | `competitionLegacyBridge.js` | 最小 |
| `chat/` | ✅ 独立 | `chatPage.js` | 否 |
| `socket/` | ✅ 独立 | `socketManager.js` | 否 |
| `notification/` | ✅ 独立 | `notifSocket.js` | 否 |
| `fortune/` | ✅ 完成 | `fortuneStore.js` | 否 |

---

## 四、数据流

### 赛事流程
```
用户操作
  → competitionPage.js（事件绑定）
  → competitionStore.js（状态管理）
  → competitionApi.js（API 调用）
  → server.js（后端路由）
  → PostgreSQL（数据持久化）
  → 返回 → competitionView.js（UI 渲染）
```

### 聊天流程
```
chatRoomManager.js（房间管理）
  → socketManager.js（WebSocket 连接）
  → chatStore.js（消息状态）
  → chatView.js（渲染）
```

---

## 五、后端架构（server.js）

### 核心路由分组
| 分组 | 路径前缀 | 说明 |
|------|----------|------|
| 认证 | `/api/auth/*` | 登录/注册 |
| 用户 | `/api/me/*` | 当前用户 |
| 俱乐部 | `/api/club/*` | CRUD |
| 赛事 | `/api/competitions/*` | 赛事系统 |
| 比赛 | `/api/matches/*` | Match 模型 |
| 结算 | `/api/admin/competitions/:id/*` | 管理员确认 |
| 预览 | `/api/competitions/:id/preview-result` | 身价预览 |
| 卜卦 | `/api/me/daily-fortune` | 每日卜卦 |
| 梦币 | `/api/me/coins` / `/api/admin/award-coins` | 梦币系统 |
| 聊天 | `/api/chat/*` | 聊天系统 |

### 中间件
- `authMiddleware` — JWT 解码 → `req.userId`
- `adminMiddleware` — 检查 `req.userId === 'mp4hmya7ad15v6'`
- `pool` — Node-postgres 连接池（Railway PostgreSQL）

---

## 六、部署架构

```
用户浏览器
    ↓ HTTPS
Cloudflare（CDN + SSL Full）
    ↓
腾讯云香港（43.132.155.208）
    ↓ Nginx（443 → proxy_pass）
Railway（perpetual-enchantment-production-b163.up.railway.app）
    ↓
Railway PostgreSQL（yamabiko.proxy.rlwy.net:35510/railway）
```

---

*最后更新：2026-05-25*
