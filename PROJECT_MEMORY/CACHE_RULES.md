# CACHE_RULES.md — 缓存 / 部署生效规则

> 更新时间：2026-05-25
> 每次前端 / 后端更新后必读，避免「明明更新了但线上没变」。

---

## 一、部署链路总览

```
本地修改
  ├── server.js 修改
  │     └→ git push origin main（qianmeng-train）
  │           └→ Railway 需要【手动 Redeploy】
  │
  ├── 前端文件修改（HTML/JS/CSS）
  │     └→ SCP 到 HK 服务器  或  git push（qianmeng-clone）
  │           ├→ GitHub Pages Action 自动部署（~1-2 min）
  │           └→ Cloudflare CDN 缓存（需清除）
  │
  └── 静态资源（图片 / 字体）
        └→ 同上，注意 Cache-Control 头
```

---

## 二、Railway 后端缓存规则

### 生效条件
1. `git push` 到 `qianmeng-train` main 分支
2. **必须手动去 Railway 控制台点「Redeploy」**
3. 等待 1-2 分钟启动完成

### 验证是否部署成功
```bash
# 路由存在 → 401（需要鉴权）
# 路由不存在 → 404
curl -s -o /dev/null -w "%{http_code}" \
  https://neondream.cn/api/competitions/00000000-0000-0000-0000-000000000001/preview-result \
  -X POST -H "Authorization: Bearer test"
# 返回 401 = 路由已上线 ✅
# 返回 404 = 还没部署 ❌
```

### Railway 部署检查清单
- [ ] `git log --oneline -1` 确认最新 commit 是你要部署的
- [ ] Railway Dashboard → Deploys → 看到该 commit
- [ ] 状态显示 `Success`
- [ ] 用 curl 验证接口（如上）

---

## 三、Cloudflare CDN 缓存规则

### 问题现象
- 前端推送了，但浏览器访问的还是旧版
- Ctrl+R 刷新没用

### 清除方法（三选一）

#### 方法 1：Cloudflare Dashboard（推荐）
1. 登录 Cloudflare → 选择 `neondream.cn`
2. 左侧菜单 → **Caching** → **Configuration**
3. 点 **Purge Everything**（清除所有缓存）

#### 方法 2：通过 API 清除（自动化）
```bash
# 需要 Cloudflare API Token
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

#### 方法 3：URL 单独清除
```
Cloudflare Dashboard
  → Caching → Purge Cache
  → 输入具体 URL（如 https://neondream.cn/index.html）
```

### cache-busting 参数（推荐用于 JS/CSS 更新）
```html
<!-- 在 index.html 引入 JS 时加版本参数 -->
<script src="app.js?v=20260525"></script>
<link rel="stylesheet" href="styles.css?v=20260525">
```
每次更新后改版本号，强制浏览器重新拉取。

---

## 四、浏览器缓存规则

### 强制刷新（用户侧）
| 操作 | Windows | macOS |
|------|---------|------|
| 普通刷新 | F5 / Ctrl+R | Cmd+R |
| **强制刷新（跳过缓存）** | **Ctrl+Shift+R** | **Cmd+Shift+R** |
| 清除站点缓存 | DevTools → Application → Clear storage | 同上 |

### 开发者工具禁用缓存（开发时）
1. F12 打开 DevTools
2. Network 标签 → 勾选 **Disable cache**
3. 保持 DevTools 打开，刷新页面

---

## 五、GitHub Pages 缓存规则

### 自动部署触发条件
- push 到 `QIANmeng2/-` main 分支
- 或 merge PR 到 main

### 部署延迟
- 通常 **1-2 分钟**完成
- 如超过 5 分钟，检查 GitHub Actions 是否有报错

### 检查部署状态
```
https://github.com/QIANmeng2/-/actions
```
确认最新 Action 状态是 ✅ green。

---

## 六、香港服务器（Nginx）缓存规则

### Nginx 缓存（如有配置）
检查 `/etc/nginx/sites-available/neondream.cn` 是否有：
```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 30d;  # ← 静态资源缓存 30 天
}
```

### 清除 Nginx 缓存（如果用了 proxy_cache）
```bash
# SSH 到 HK 服务器
ssh ubuntu@43.132.155.208 -i ~/.ssh/hk_server
sudo rm -rf /var/cache/nginx/*
sudo nginx -s reload
```

### 当前 Nginx 配置状态
- **当前**：Nginx 只做反向代理（`proxy_pass` 到 Railway），**不缓存**静态资源
- 静态资源由 GitHub Pages / Cloudflare 缓存
- 所以 **HK 服务器通常不需要清缓存**

---

## 七、数据库查询结果缓存（注意）

### 问题
`pool.query()` 每次都查 DB，没有应用层缓存——**所以不存在 DB 缓存问题**。

### 但注意：浏览器会缓存 GET 请求
```js
// ❌ 可能被浏览器缓存
fetch('/api/me/coins');  // GET 默认可缓存

// ✅ 加时间戳防止缓存
fetch('/api/me/coins?_t=' + Date.now());
```

### 后端禁止浏览器缓存（已加）
```js
// server.js 顶部已有的中间件
res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
res.setHeader('Pragma', 'no-cache');
res.setHeader('Expires', '0');
```

---

## 八、更新后标准验证流程

### 后端（Railway）
```
1. git push（qianmeng-train）
2. Railway Dashboard → Redeploy
3. 等待 deploy 成功（green checkmark）
4. curl 验证接口（401 = 存在，404 = 不存在）
5. 用真实 token 测试完整功能
```

### 前端（GitHub Pages + Cloudflare）
```
1. 推送前端代码（qianmeng-clone 或 SCP）
2. 等待 GitHub Actions 完成（~1-2 min）
3. Cloudflare Dashboard → Purge Everything
4. 浏览器强制刷新（Ctrl+Shift+R）
5. F12 → Network → 确认 JS/CSS 是最新版本（看 Response Header 里的 ETag/Last-Modified）
```

---

## 九、常见「更新不生效」排查表

| 现象 | 可能原因 | 解决方案 |
|--------|----------|----------|
| 后端接口 404 | Railway 还没部署 | 去 Railway 点 Redeploy |
| 后端接口 500 | 最新代码有语法错误 | 看 Railway → Deploy Logs |
| 前端样式没变 | Cloudflare 缓存 | Purge Everything |
| 前端 JS 逻辑没变 | 浏览器缓存 | Ctrl+Shift+R 强制刷新 |
| 数据库改动没生效 | 没跑 migration | 手动执行 ALTER TABLE |
| 部署成功但功能不对 | 部署的不是最新 commit | `git log --oneline -1` 确认 |

---

## 十、禁止事项

- ❌ 禁止假设「推送 = 线上已更新」（必须验证）
- ❌ 禁止只 push 不手动 Redeploy（Railway 不会自动部署）
- ❌ 禁止前端更新后不清除 Cloudflare 缓存
- ✅ 每次更新后按「八、标准验证流程」操作

---

*最后更新：2026-05-25*
