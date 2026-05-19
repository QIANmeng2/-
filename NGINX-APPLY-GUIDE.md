# Nginx 性能优化配置 - 应用指南

## 文件路径

| 文件 | 用途 | 服务器路径 |
|---|---|---|
| `nginx-qianmeng.conf` | 主配置文件（gzip/cache/ssl） | `/etc/nginx/nginx.conf`（覆盖或合并） |
| `nginx-websocket.conf` | Socket.IO WebSocket 代理优化 | `/etc/nginx/conf.d/websocket-upstream.conf` |
| `server-monitor.sh` | 服务器资源监控脚本 | `/root/server-monitor.sh` |

---

## 步骤 1：上传配置文件到服务器

```bash
# 在本地（Windows / 你的电脑）
scp nginx-qianmeng.conf root@your_server_ip:/tmp/nginx-qianmeng.conf
scp nginx-websocket.conf root@your_server_ip:/tmp/nginx-websocket.conf
scp server-monitor.sh root@your_server_ip:/root/server-monitor.sh
```

或通过腾讯云 WebShell / VS Code Remote 直接上传。

---

## 步骤 2：合并 Nginx 主配置

**不要直接覆盖** `/etc/nginx/nginx.conf`，而是合并关键指令：

```bash
# 备份原配置
cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak.$(date +%Y%m%d)

# 编辑配置
vim /etc/nginx/nginx.conf
```

需要合并的关键配置（对照 `nginx-qianmeng.conf`）：

```nginx
# 在 http { 块内添加 / 修改：
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml+rss image/svg+xml;

# 连接优化
keepalive_timeout  75s;
keepalive_requests 1000;
sendfile on;
tcp_nopush on;
tcp_nodelay on;

# 代理超时
proxy_connect_timeout 10s;
proxy_send_timeout   60s;
proxy_read_timeout   60s;
```

---

## 步骤 3：启用 WebSocket 代理配置

```bash
# 将 WebSocket 配置放到 conf.d 目录
cp /tmp/nginx-websocket.conf /etc/nginx/conf.d/websocket-upstream.conf

# 在主配置的 location /api/ 块中引入 WebSocket 升级
vim /etc/nginx/nginx.conf
# 在 server { 块内添加：
# include /etc/nginx/conf.d/websocket-upstream.conf;
```

---

## 步骤 4：测试并 reload Nginx

```bash
# 测试配置是否有语法错误
nginx -t

# 无误后 reload（不中断服务）
nginx -s reload

# 或
systemctl reload nginx
```

---

## 步骤 5：部署 favicon.ico

```bash
# 将 favicon.ico 放到网站根目录
scp favicon.ico root@your_server_ip:/var/www/neondream/favicon.ico

# 确保 Nginx 配置中有：
# location = /favicon.ico { access_log off; log_not_found off; }
```

---

## 步骤 6：启用服务器监控脚本

```bash
chmod +x /root/server-monitor.sh

# 测试运行
bash /root/server-monitor.sh

# 添加到 crontab（每 5 分钟执行）
crontab -e
# 添加：
# */5 * * * * bash /root/server-monitor.sh >> /var/log/neondream-monitor.log 2>&1

# 查看日志
tail -f /var/log/neondream-monitor.log
```

---

## 步骤 7：验证优化效果

```bash
# 1. 检查 gzip 是否生效
curl -H "Accept-Encoding: gzip" -I https://neondream.cn

# 2. 检查缓存头
curl -I https://neondream.cn/styles.css

# 3. 检查 WebSocket 连接
# 浏览器 F12 → Network → WS 标签 → 确认 Connection: upgrade

# 4. 压力测试（安装 siege 或 ab）
ab -n 1000 -c 10 https://neondream.cn/
```

---

## 常见问题

### Q: Nginx -t 报错 "unknown directive gzip"
A: Nginx 编译时未启用 gzip 模块，安装 `nginx-full` 或重新编译。

### Q: WebSocket 连接失败（101 Switching Protocols 未出现）
A: 确认 `proxy_set_header Upgrade $http_upgrade;` 和 `Connection "upgrade"` 已配置。

### Q: 证书路径不正确
A: 修改 `ssl_certificate` 和 `ssl_certificate_key` 为腾讯云证书实际路径。
```