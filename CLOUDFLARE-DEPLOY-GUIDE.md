# neondream.cn — Cloudflare + 腾讯云 部署优化指南
# 目标：不备案，最大化大陆访问速度

# ============================================
# 第一部分：Cloudflare DNS 配置
# ============================================

## DNS 记录设置

| 类型 | 名称 | 内容（你的腾讯云香港服务器 IP） | Proxy 状态 |
|------|------|------------------------------------------|------------|
| A    | neondream.cn | 175.178.52.116 | ✅ Orange Cloud（代理开启） |
| A    | www          | 175.178.52.116 | ✅ Orange Cloud（代理开启） |
| A    | backup       | 175.178.52.116 | ❌ DNS Only（备用直连） |

### 操作位置
Cloudflare Dashboard → neondream.cn → DNS → Records

### 注意事项
- 服务器 IP 需要是「香港区」腾讯云 CVM（大陆延迟最低）
- 如果服务器本身 IP 已被墙，需要换 IP 或走 Cloudflare Argo Tunnel

# ============================================
# 第二部分：Cloudflare SSL/TLS 设置
# ============================================

## SSL 模式：**Full (Strict)**（推荐）

位置：Cloudflare → SSL/TLS → Overview

选项对比：
- Flexible：❌ 不安全，Nginx 收到 HTTP 可能被劫持
- Full：✅ 推荐。Cloudflare → 服务器 用 HTTPS（需服务器有证书）
- Full (Strict)：✅✅ 最安全，需要有效证书（Let's Encrypt 或 Cloudflare Origin CA）
- Off：❌ 禁用 HTTPS，不推荐

### 推荐方案：Cloudflare Origin CA（免费）
1. Cloudflare → SSL/TLS → Origin Server → Create Certificate
2. 选择 `RSA 2048`，有效期 15 年
3. 下载 `origin.pem`（证书）和 `origin.key`（私钥）
4. 上传到服务器 `/etc/nginx/ssl/neondream.cn.pem` 和 `.key`
5. SSL 模式设为 **Full (Strict)**

（这样 Cloudflare ↔ 服务器之间也是加密的，且免费）

# ============================================
# 第三部分：Cloudflare Cache Rules（缓存规则）
# ============================================

## 目标
- 静态资源（JS/CSS/图片）：Cloudflare CDN 缓存 1 年
- HTML（SPA）：不缓存（每次回源）
- /api/*：不缓存（动态数据）

## 创建 Cache Rule（3 条，按顺序）

### Rule 1：API 不缓存（最高优先级）
- Rule name: `API - No Cache`
- If: `Wildcard: neondream.cn/api/*`
- Cache status: **Bypass cache**
- 保存

### Rule 2：静态资源长缓存
- Rule name: `Static Assets - Long Cache`
- If: `Wildcard: neondream.cn/*.(js,css,png,jpg,jpeg,webp,svg,woff2,ico,json)`
- Cache status: **Cache everything**
- Edge Cache TTL: `1 year`
- Ignore query string: **No**（保留 ?v=xxx 版本号）
- 保存

### Rule 3：HTML 不缓存
- Rule name: `HTML - No Cache`
- If: `Wildcard: neondream.cn/*.html`
- Cache status: **Bypass cache**
- 保存

# ============================================
# 第四部分：Cloudflare Speed 优化
# ============================================

位置：Cloudflare → Speed → Optimization

逐个开启：
- ✅ **Auto Minify**: JS / CSS / HTML 全部勾选
- ✅ **Brotli**: 开启（比 gzip 小 15-20%）
- ✅ **HTTP/3 (QUIC)**: 开启（大陆部分 ISP 支持）
- ✅ **Early Hints**: 开启（配合 Link rel=preconnect）
- ✅ **0-RTT**: 开启（TLS 0-RTT 恢复）

# ============================================
# 第五部分：Cloudflare Network 设置
# ============================================

位置：Cloudflare → Network

- ✅ HTTP/2: 开启
- ✅ HTTP/3 (QUIC): 开启
- ✅ 0-RTT: 开启
- ✅ WebSockets: 开启（必须！Socket.IO 依赖）
- ✅ Always Online: 开启（服务器宕机时显示缓存页）
- ✅ Onion Routing: 关闭（不需要 Tor）
- ✅ Response Buffering: 关闭（实时通信需要）

# ============================================
# 第六部分：Cloudflare Page Rules（备用方案）
# ============================================

如果 Cache Rules（第三部分）不可用（免费版限制），用 Page Rules 替代：

| URL Pattern | Setting | Value |
|-------------|---------|-------|
| neondream.cn/api/* | Cache Level | Bypass |
| neondream.cn/*.js, *.css, *.png, *.jpg | Cache Level | Cache Everything |
| | Edge Cache TTL | 1 year |
| neondream.cn/* | Automatic HTTPS Rewrites | On |

# ============================================
# 第七部分：服务器 Nginx 部署步骤
# ============================================

## 步骤 1：上传 SSL 证书（Cloudflare Origin CA）

```bash
# 在服务器上
sudo mkdir -p /etc/nginx/ssl
# 把 origin.pem 和 origin.key 上传到这个目录
sudo chmod 600 /etc/nginx/ssl/neondream.cn.key
sudo chown root:root /etc/nginx/ssl/*
```

## 步骤 2：部署 nginx 配置

```bash
# 把 nginx-qianmeng-full.conf 上传到服务器
scp nginx-qianmeng-full.conf ubuntu@175.178.52.116:/tmp/nginx-qianmeng-full.conf

# SSH 登录服务器
ssh ubuntu@175.178.52.116

# 备份原配置
sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak
sudo cp /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.bak 2>/dev/null || true

# 写入新配置（HTTPS 443 部分需要先有证书才能取消注释）
sudo cp /tmp/nginx-qianmeng-full.conf /etc/nginx/sites-available/neondream
sudo ln -sf /etc/nginx/sites-available/neondream /etc/nginx/sites-enabled/neondream

# 测试配置
sudo nginx -t

# 重载
sudo systemctl reload nginx
```

## 步骤 3：部署前端文件

```bash
# 从 GitHub 拉取最新代码到服务器
ssh ubuntu@175.178.52.116

# 先备份
sudo cp -r /var/www/html /var/www/html.bak.$(date +%Y%m%d)

# 拉取最新 main 分支
cd /tmp && git clone --depth=1 https://github.com/QIANmeng2/-.git qianmeng-pull
sudo cp -r /tmp/qianmeng-pull/qianmeng-clone/* /var/www/html/
sudo chown -R www-data:www-data /var/www/html

# 验证
curl -s http://localhost/ | head -5
```

## 步骤 4：启动 / 重启 Node.js 后端

```bash
# 检查 server.js 是否运行
ps aux | grep "node.*server.js"

# 如果没有运行，用 PM2 启动
cd /var/www/html
pm2 start server.js --name qianmeng-api --log /var/log/qianmeng.log
pm2 save

# 如果已运行，重启
pm2 restart qianmeng-api
```

# ============================================
# 第八部分：验证清单
# ============================================

逐项验证，全部 ✅ 才算完成：

- [ ] DNS：Cloudflare Orange Cloud 已开启（A 记录旁有橙色云朵）
- [ ] SSL：访问 https://neondream.cn 显示绿色锁（SSL Labs 测试 A 以上）
- [ ] Cache：Response Header 有 `cf-cache-status: HIT`（静态资源）
- [ ] API：`/api/health` 返回 200，且 `cf-cache-status: BYPASS`
- [ ] WebSocket：Console 无 `WebSocket connection failed`，Socket.IO 正常连接
- [ ] HTML：更新 index.html 后刷新，立即看到新内容（无缓存）
- [ ] 中国大陆访问：用手机 4G 访问，延迟 < 300ms（香港服务器 + Cloudflare）
- [ ] 回滚：服务器上 `/var/www/html.bak.*` 存在，可快速恢复

# ============================================
# 回滚方案
# ============================================

## 回滚前端
```bash
ssh ubuntu@175.178.52.116
sudo cp -r /var/www/html.bak.YYYYMMDD/* /var/www/html/
sudo systemctl reload nginx
```

## 回滚 nginx 配置
```bash
ssh ubuntu@175.178.52.116
sudo cp /etc/nginx/nginx.conf.bak /etc/nginx/nginx.conf
sudo cp /etc/nginx/sites-enabled/default.bak /etc/nginx/sites-enabled/default 2>/dev/null || true
sudo nginx -t && sudo systemctl reload nginx
```

## 回滚 Git
```bash
cd /c/Users/ASUS/WorkBuddy/2026-05-14-task-1/qianmeng-clone
git log --oneline -5
git revert <commit-hash>   # 撤销某次提交
git push origin main
```

# ============================================
# 后续建议（备案前临时方案）
# ============================================

1. **备案前**：当前架构（Cloudflare + 香港服务器）可以稳定支撑 100-500 并发
2. **备案后**：迁移到大陆服务器（腾讯云北京/上海），域名解析到大陆 IP，关闭 Cloudflare Proxy（或继续用）
3. **性能监控**：Cloudflare Analytics 免费提供流量、缓存率、威胁报告
4. **DDoS 防护**：Cloudflare 免费提供 5Gbps 以下 DDoS 防护，无需额外配置
5. **图片优化**：把 `styles/images/` 里的图片转 WebP（可节省 30-50% 带宽）
