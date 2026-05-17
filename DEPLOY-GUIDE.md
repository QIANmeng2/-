# 梦工厂·王者 — 服务器部署图文指南

## 前置：SSH 连接服务器

**需要什么软件？**
- Windows 10/11 自带 `ssh` 命令（PowerShell 或 CMD）
- 或者用 Xshell、Putty、FinalShell 等专业工具

---

## 步骤 1：打开终端连接服务器

**Windows 方法**：
```
按 Win+R → 输入 cmd → 回车 → 输入：
ssh ubuntu@175.178.52.116
```

弹出提示输密码时输入：`PJH1999pjh`

看到这个画面就成功了：
```
Welcome to Ubuntu 22.04 LTS
ubuntu@VM-0-0-ubuntu:~$
```

---

## 步骤 2：运行一键部署脚本

复制粘贴这一条命令（右键粘贴或 Ctrl+V）：

```bash
wget -qO- https://raw.githubusercontent.com/QIANmeng2/-/main/setup-server.sh | sudo bash
```

脚本自动完成 7 步：
1. ✅ 更新系统软件包
2. ✅ 安装并启动 Nginx
3. ✅ 配置防火墙（开放 80/443/22 端口）
4. ✅ 从 GitHub 拉取网站文件
5. ✅ 配置 Nginx 虚拟主机
6. ✅ 申请 Let's Encrypt 免费 HTTPS 证书
7. ✅ 设置证书自动续期

全程约 5-10 分钟，看到 `✅ 服务器部署完成！` 就搞定。

---

## 步骤 3：验证部署结果

浏览器访问：

| 地址 | 预期结果 |
|---|---|
| http://backup.neondream.cn | 显示梦工厂网站 |
| http://175.178.52.116 | 显示梦工厂网站（直连IP） |

---

## 遇到问题？

| 错误 | 解决 |
|---|---|
| 连接超时 | 检查服务器是否开机 |
| Permission denied | 密码错误，再试一次 |
| wget 404 | 等 1 分钟后 GitHub 缓存同步再试 |
| certbot 失败 | DNS 未生效，可以先跳过（ctrl+c 跳过这步）|

---

## 完成后告诉我

我会继续配置 GitHub Actions 自动同步（以后每次推代码，服务器自动更新）。
