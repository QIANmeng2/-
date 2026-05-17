# 梦工厂·王者 — neondream.cn 全流程部署报告

**日期**：2026-05-17  
**域名**：neondream.cn  
**项目**：梦工厂·王者荣耀训练赛生态平台  

---

## 一、部署架构

```
用户访问 neondream.cn
         │
    ┌────┴────┐
    ↓         ↓
GitHub Pages   腾讯云轻量服务器
(185.199.x.x)  (175.178.52.116)
    │              │
    ├─ 主站        ├─ 备用 CDN
    ├─ 免费 HTTPS  ├─ 国内加速
    └─ 自动 CDN    └─ Let's Encrypt
```

---

## 二、访问地址

| 地址 | 状态 | 平台 | 用途 |
|---|---|---|---|
| https://neondream.cn | ✅ 正常 | GitHub Pages | **主站**（全球 CDN）|
| https://www.neondream.cn | ✅ 跳转 | GitHub Pages | 带 www 访问 |
| https://backup.neondream.cn | ✅ 正常 | 腾讯云服务器 | **备用站**（国内加速）|
| http://175.178.52.116 | ✅ 正常 | 腾讯云服务器 | 紧急备用（直连 IP）|

---

## 三、DNS 解析配置

| 主机记录 | 类型 | 记录值 | TTL |
|---|---|---|---|
| @ | A | 185.199.108.153 | 600 |
| www | CNAME | qianmeng2.github.io | 600 |
| backup | A | 175.178.52.116 | 600 |

---

## 四、服务器配置

| 项目 | 详情 |
|---|---|
| **系统** | Ubuntu 22.04 LTS |
| **Web 服务** | Nginx |
| **网站路径** | /var/www/neondream.cn |
| **防火墙** | 22(SSH) / 80(HTTP) / 443(HTTPS) 开放 |
| **HTTPS 证书** | Let's Encrypt（3个月自动续期）|
| **证书路径** | /etc/letsencrypt/live/backup.neondream.cn/ |
| **到期时间** | 2026-08-14 |

---

## 五、GitHub Pages 配置

| 项目 | 详情 |
|---|---|
| **仓库** | QIANmeng2/- |
| **自定义域名** | neondream.cn |
| **HTTPS** | 已启用强制 HTTPS |
| **自动部署** | GitHub Actions（每次 push 自动更新） |

---

## 六、安全评分

| 检查项 | 状态 | 得分 |
|---|---|---|
| HTTPS 加密 | ✅ 已配置 | 20/20 |
| 防火墙 | ✅ 仅开放必要端口 | 20/20 |
| 自动续期 | ✅ crontab 已设置 | 20/20 |
| 自动备份 | ⚠️ 未配置 | 5/20 |
| DDoS 防护 | ⚠️ 仅 GitHub Pages 自带 | 10/20 |
| 访问日志 | ⚠️ 未配置分析 | 10/20 |
| **总分** | | **85/100** |

---

## 七、下一步待办

1. ✅ DNS 解析配置完成
2. ✅ GitHub Pages 自定义域名绑定完成
3. ✅ 服务器环境部署完成
4. ✅ HTTPS 证书申请完成
5. ⏳ **ICP 备案**（备案通过后切换主域名指向服务器）
6. ⏳ GitHub Actions 自动同步（代码 push → 服务器自动更新）
7. ⏳ 网站访问统计接入
8. ⏳ 定期备份配置

---

## 八、服务器管理命令速查

```bash
# SSH 连接
ssh ubuntu@175.178.52.116

# 重启 Nginx
sudo systemctl restart nginx

# 查看 Nginx 状态
sudo systemctl status nginx

# 手动更新网站
cd /var/www/neondream.cn && sudo git pull

# 手动续期证书
sudo certbot renew

# 查看证书信息
sudo certbot certificates
```

---

**报告生成时间**：2026-05-17 04:50 CST  
**执行人**：浅梦9.43  
**部署工具**：WorkBuddy AI
