#!/bin/bash
# ============================================
# neondream.cn 一键部署脚本（优化版）
# 用法（在腾讯云服务器上执行）：
#   curl -sL https://raw.githubusercontent.com/QIANmeng2/-/main/deploy-optimized.sh | sudo bash
# 或上传后执行：
#   sudo bash deploy-optimized.sh
# ============================================

set -e

LOG="/var/log/qianmeng-deploy.log"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[OK]${NC} $1" | tee -a $LOG; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1" | tee -a $LOG; }
err()  { echo -e "${RED}[ERR]${NC} $1" | tee -a $LOG; }

echo "====================================="
echo "  梦工厂·王者 优化部署脚本"
echo "  目标：Cloudflare CDN + 腾讯云香港"
echo "====================================="
echo ""

# ------- Step 1：系统更新 + 安装依赖 -------
log "Step 1/8：安装 Nginx + Node.js + PM2 ..."
apt-get update -qq
apt-get install -y -qq nginx curl wget git 2>&1 | tee -a $LOG

# 安装 Node.js 24.x（与本地一致）
if ! command -v node &>/dev/null || [[ "$(node -v 2>/dev/null | cut -d. -f1 | tr -d v)" -lt 24 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
    apt-get install -y -qq nodejs
fi
log "Node.js $(node -v) 已安装"

# 安装 PM2
if ! command -v pm2 &>/dev/null; then
    npm install -g pm2
fi
log "PM2 已安装"

# ------- Step 2：备份当前配置 -------
log "Step 2/8：备份当前配置 ..."
BACKUP_TAG=$(date +%Y%m%d_%H%M%S)
mkdir -p /var/backups/qianmeng

if [ -d /var/www/html ]; then
    cp -r /var/www/html "/var/backups/qianmeng/html.$BACKUP_TAG" 2>/dev/null || true
    log "前端备份 → /var/backups/qianmeng/html.$BACKUP_TAG"
fi
if [ -f /etc/nginx/sites-enabled/neondream ]; then
    cp /etc/nginx/sites-enabled/neondream "/var/backups/qianmeng/nginx.$BACKUP_TAG.bak" 2>/dev/null || true
    log "Nginx 配置备份 → /var/backups/qianmeng/nginx.$BACKUP_TAG.bak"
fi
if [ -f /etc/nginx/nginx.conf ]; then
    cp /etc/nginx/nginx.conf "/var/backups/qianmeng/nginx.conf.$BACKUP_TAG.bak"
    log "Nginx 主配置备份 → /var/backups/qianmeng/nginx.conf.$BACKUP_TAG.bak"
fi

# ------- Step 3：拉取最新前端代码 -------
log "Step 3/8：从 GitHub 拉取最新前端代码 ..."
TMP_DIR="/tmp/qianmeng-pull-$BACKUP_TAG"
mkdir -p $TMP_DIR
cd $TMP_DIR
git clone --depth=1 --single-branch --branch main https://github.com/QIANmeng2/-.git qianmeng-tmp 2>&1 | tee -a $LOG
# GitHub 仓库名是 "-"（QIANmeng2/-），克隆后目录名可能被 git 自动处理
cd $TMP_DIR/*/qianmeng-clone 2>/dev/null || cd $TMP_DIR/qianmeng-clone 2>/dev/null || {
    err "无法找到 qianmeng-clone 目录，请手动检查 $TMP_DIR"
    exit 1
}

# 复制前端文件
mkdir -p /var/www/html
cp -r ./* /var/www/html/ 2>/dev/null || true
# 保留 .htaccess / _headers（GitHub Pages 用）
[ -f _headers ] && cp _headers /var/www/html/ 2>/dev/null || true
chown -R www-data:www-data /var/www/html
log "前端文件已更新 → /var/www/html"

# ------- Step 4：部署 Node.js 后端 -------
log "Step 4/8：部署 Node.js 后端（server.js）..."
# server.js 放在 /var/www/api/
mkdir -p /var/www/api
cd /var/www/api

# 如果已有 server.js，备份
[ -f server.js ] && cp server.js "/var/backups/qianmeng/server.js.$BACKUP_TAG.bak"

# 从拉取的代码里复制 server.js 和 package.json
if [ -f $TMP_DIR/*/qianmeng-clone/server.js ] 2>/dev/null; then
    cp $TMP_DIR/*/qianmeng-clone/server.js /var/www/api/ 2>/dev/null || true
    cp $TMP_DIR/*/qianmeng-clone/package.json /var/www/api/ 2>/dev/null || true
elif [ -f $TMP_DIR/qianmeng-clone/server.js ]; then
    cp $TMP_DIR/qianmeng-clone/server.js /var/www/api/
    cp $TMP_DIR/qianmeng-clone/package.json /var/www/api/ 2>/dev/null || true
fi

# 安装 npm 依赖
cd /var/www/api
npm install --production 2>&1 | tee -a $LOG
log "npm 依赖已安装"

# 检查环境变量文件
if [ ! -f .env ]; then
    warn ".env 文件不存在！请手动创建 /var/www/api/.env"
    warn "需要：DATABASE_URL, JWT_SECRET, TENCENT_SECRET_ID, TENCENT_SECRET_KEY, PORT=8080"
fi

# ------- Step 5：配置 Nginx -------
log "Step 5/8：配置 Nginx（优化版）..."

# 写入优化后的 nginx 站点配置
cat > /etc/nginx/sites-available/neondream << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name neondream.cn www.neondream.cn;

    root /var/www/html;
    index index.html;

    # 静态资源：长缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|webp|avif)$ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        add_header Access-Control-Allow-Origin *;
        access_log off;
    }

    # HTML：不缓存
    location ~* \.html$ {
        expires -1;
        add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0" always;
        add_header Pragma "no-cache" always;
    }

    # favicon
    location = /favicon.ico {
        access_log off;
        log_not_found off;
    }

    # Socket.IO / WebSocket 代理
    location /socket.io/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
    }

    # Node.js API 代理（不缓存）
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    }

    # 健康检查
    location = /health {
        access_log off;
        return 200 "OK\n";
        add_header Content-Type "text/plain";
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

# 启用站点
ln -sf /etc/nginx/sites-available/neondream /etc/nginx/sites-enabled/neondream
# 禁用 default 站点（如果存在）
rm -f /etc/nginx/sites-enabled/default

# 测试 Nginx 配置
nginx -t 2>&1 | tee -a $LOG
if [ $? -eq 0 ]; then
    systemctl reload nginx
    log "Nginx 配置已生效"
else
    err "Nginx 配置测试失败！请检查 /etc/nginx/sites-available/neondream"
    exit 1
fi

# ------- Step 6：启动 / 重启后端 API -------
log "Step 6/8：PM2 管理 Node.js 后端 ..."
cd /var/www/api

# 停止旧进程（如果有）
pm2 delete qianmeng-api 2>/dev/null || true

# 启动新进程
pm2 start server.js --name qianmeng-api --log /var/log/qianmeng-api.log --time
pm2 save --force 2>/dev/null || true

# 设置开机自启
pm2 startup 2>/dev/null || true

log "PM2 进程 qianmeng-api 已启动"

# ------- Step 7：配置防火墙 -------
log "Step 7/8：配置防火墙（开放 80/443/22）..."
if command -v ufw &>/dev/null; then
    ufw --force enable 2>/dev/null || true
    ufw allow 22/tcp 2>/dev/null || true
    ufw allow 80/tcp 2>/dev/null || true
    ufw allow 443/tcp 2>/dev/null || true
    log "UFW 防火墙已配置"
elif command -v firewall-cmd &>/dev/null; then
    firewall-cmd --permanent --add-service=http 2>/dev/null || true
    firewall-cmd --permanent --add-service=https 2>/dev/null || true
    firewall-cmd --reload 2>/dev/null || true
    log "firewalld 防火墙已配置"
fi

# ------- Step 8：验证 -------
log "Step 8/8：验证部署结果 ..."
sleep 2

echo ""
echo "--- 验证结果 ---"
echo -n "Nginx 状态："; systemctl is-active --quiet nginx && echo "✅ running" || echo "❌ stopped"
echo -n "PM2 状态：  "; pm2 pid qianmeng-api >/dev/null 2>&1 && echo "✅ running" || echo "❌ stopped"
echo -n "本地 HTTP： "; curl -s -o /dev/null -w "%{http_code}" http://localhost/ | grep -q "200\|301\|302" && echo "✅ OK" || echo "❌ FAIL"
echo -n "API 健康检查："; curl -s -o /dev/null -w "%{http_code}" http://localhost/health | grep -q "200" && echo "✅ OK" || echo "❌ FAIL"
echo -n "WebSocket 代理："; curl -s -o /dev/null -w "%{http_code}" http://localhost/socket.io/?EIO=4\&transport=polling 2>/dev/null | grep -q "200" && echo "✅ OK" || echo "⚠️  需进一步验证"
echo ""

echo "====================================="
log "部署完成！"
echo ""
echo "📋 后续手动操作："
echo "  1. 确认 Cloudflare DNS：A 记录指向 $(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null)"
echo "  2. Cloudflare SSL 模式设为 Full 或 Full (Strict)"
echo "  3. 上传 Cloudflare Origin CA 证书到 /etc/nginx/ssl/ 并取消 nginx 配置里 443 的注释"
echo "  4. 确认 /var/www/api/.env 环境变量已正确配置"
echo "  5. 访问 https://neondream.cn 验证"
echo ""
echo "📦 回滚命令："
echo "  sudo cp -r /var/backups/qianmeng/html.$BACKUP_TAG/* /var/www/html/"
echo "  sudo pm2 restart qianmeng-api"
echo ""
