#!/bin/bash
# ============================================
# 梦工厂·王者 - 腾讯云轻量服务器部署脚本
# 在服务器上执行: bash setup-server.sh
# ============================================
set -e

DOMAIN="neondream.cn"
WEBROOT="/var/www/$DOMAIN"
REPO="https://github.com/QIANmeng2/-.git"

echo "=== [1/7] 更新系统 ==="
sudo apt update && sudo apt upgrade -y

echo "=== [2/7] 安装 Nginx ==="
sudo apt install nginx -y
sudo systemctl start nginx
sudo systemctl enable nginx

echo "=== [3/7] 配置防火墙 ==="
sudo ufw allow 'Nginx Full'
sudo ufw allow ssh
sudo ufw --force enable

echo "=== [4/7] 部署网站文件 ==="
sudo mkdir -p $WEBROOT
sudo git clone $REPO /tmp/qianmeng-deploy
sudo cp -r /tmp/qianmeng-deploy/* $WEBROOT/
sudo rm -rf /tmp/qianmeng-deploy
sudo chown -R www-data:www-data $WEBROOT

echo "=== [5/7] 配置 Nginx 虚拟主机 ==="
sudo tee /etc/nginx/sites-available/$DOMAIN > /dev/null << 'NGINXEOF'
server {
    listen 80;
    server_name neondream.cn www.neondream.cn backup.neondream.cn;
    root /var/www/neondream.cn;
    index index.html;
    location / { try_files $uri $uri/ =404; }
}
NGINXEOF
sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo "=== [6/7] 配置 HTTPS (Let's Encrypt) ==="
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN -d backup.$DOMAIN \
  --non-interactive --agree-tos --email admin@$DOMAIN \
  --redirect 2>&1 || echo "⚠️ HTTPS 配置跳过（可能域名 DNS 未生效）"

echo "=== [7/7] 证书自动续期 ==="
(crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -

echo ""
echo "========================================"
echo "  ✅ 服务器部署完成！"
echo "  访问: http://$DOMAIN"
echo "  备用: http://backup.$DOMAIN"
echo "========================================"
