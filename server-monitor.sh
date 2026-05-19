#!/bin/bash
# ============================================
# neondream.cn 服务器资源监控脚本
# 适用：Tencent Cloud CVM (CentOS/Ubuntu)
# 用法：bash server-monitor.sh
# 定时：*/5 * * * * bash /path/to/server-monitor.sh >> /var/log/neondream-monitor.log 2>&1
# ============================================

set -euo pipefail

# ------- 配置 -------
LOG_FILE="/var/log/neondream-monitor.log"
ALERT_WEBHOOK=""  # 可选：企业微信/钉钉 webhook URL
DISK_THRESHOLD=85   # 磁盘使用率 % 触发告警
MEM_THRESHOLD=90     # 内存使用率 % 触发告警
CPU_THRESHOLD=85     # CPU 使用率 % 触发告警
LOAD_THRESHOLD=4      # Load Average (1min) 触发告警

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

send_alert() {
    local msg="$1"
    log "ALERT: $msg"
    if [[ -n "$ALERT_WEBHOOK" ]]; then
        curl -s -X POST "$ALERT_WEBHOOK" \
            -H "Content-Type: application/json" \
            -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"neondream.cn 告警\n$msg\"}}" \
            &>/dev/null || true
    fi
}

# ------- 系统信息 -------
HOSTNAME=$(hostname)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

log "========= 监控报告 @ $HOSTNAME [${TIMESTAMP}] ========="

# ------- 1. CPU 使用率 -------
CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print 100 - $8}' | awk '{print int($1)}' 2>/dev/null || \
            top -bn1 | grep "CPU" | awk '{print int($2)}' 2>/dev/null || \
            echo "N/A")
if [[ "$CPU_USAGE" != "N/A" && "$CPU_USAGE" -ge "$CPU_THRESHOLD" ]]; then
    send_alert "CPU 使用率过高: ${CPU_USAGE}% (阈值 ${CPU_THRESHOLD}%)"
fi
log "CPU 使用率: ${CPU_USAGE}%"

# ------- 2. Load Average -------
LOAD1=$(cat /proc/loadavg | awk '{print $1}')
LOAD_INT=$(echo "$LOAD1" | cut -d. -f1)
if [[ -n "$LOAD_INT" && "$LOAD_INT" -ge "$LOAD_THRESHOLD" ]]; then
    send_alert "Load Average 过高: ${LOAD1} (阈值 ${LOAD_THRESHOLD})"
fi
log "Load Average (1min): $LOAD1"

# ------- 3. 内存使用率 -------
MEM_INFO=$(free | awk '/Mem:/ {printf "%.0f %.0f %.0f", $3/$2*100, $2/1024, $3/1024}')
MEM_USAGE=$(echo "$MEM_INFO" | awk '{print $1}')
MEM_TOTAL=$(echo "$MEM_INFO" | awk '{print $2}')
MEM_USED=$(echo "$MEM_INFO" | awk '{print $3}')
if [[ "$MEM_USAGE" -ge "$MEM_THRESHOLD" ]]; then
    send_alert "内存使用率过高: ${MEM_USAGE}% (${MEM_USED}MB/${MEM_TOTAL}MB)"
fi
log "内存: ${MEM_USED}MB / ${MEM_TOTAL}MB (${MEM_USAGE}%)"

# ------- 4. 磁盘使用率 -------
log "--- 磁盘使用率 ---"
df -h | awk 'NR==1 || /^\/dev\// || /^\/ $/ {print}' | while read line; do
    log "$line"
done
DISK_USAGE=$(df / | awk 'NR==2 {gsub(/%/,""); print $5}')
if [[ "$DISK_USAGE" -ge "$DISK_THRESHOLD" ]]; then
    send_alert "磁盘使用率过高: ${DISK_USAGE}% (阈值 ${DISK_THRESHOLD}%)"
fi

# ------- 5. 网络带宽（当前连接数）-------
CONN_COUNT=$(ss -s 2>/dev/null | grep "estab" | awk '{print $2}' || netstat -an 2>/dev/null | grep ESTABLISHED | wc -l)
log "TCP 已建立连接数: ${CONN_COUNT:-0}"

# ------- 6. Node.js 进程检查 -------
log "--- Node.js 进程 ---"
PM2_PROCS=$(pm2 list 2>/dev/null | grep "online" | wc -l || echo 0)
if [[ "$PM2_PROCS" -eq 0 ]]; then
    NODE_PROCS=$(ps aux | grep "node.*server.js" | grep -v grep | wc -l)
    log "Node 进程 (非 pm2): $NODE_PROCS"
    if [[ "$NODE_PROCS" -eq 0 ]]; then
        send_alert "Node.js 进程未运行！"
    fi
else
    log "PM2 在线进程数: $PM2_PROCS"
fi

# ------- 7. Nginx 状态 -------
log "--- Nginx 状态 ---"
if systemctl is-active --quiet nginx; then
    log "Nginx: 运行中"
    NGINX_CONN=$(curl -s http://127.0.0.1/nginx_status 2>/dev/null | grep "Active connections" | awk '{print $3}' || echo "N/A")
    log "Nginx 活跃连接: ${NGINX_CONN:-N/A}"
else
    log "Nginx: 未运行！"
    send_alert "Nginx 服务未运行！"
fi

# ------- 8. 端口监听检查 -------
log "--- 关键端口监听 ---"
for port in 80 443 3000; do
    if ss -tlnp 2>/dev/null | grep -q ":$port " || netstat -tlnp 2>/dev/null | grep -q ":$port "; then
        log "端口 $port: 监听中"
    else
        log "端口 $port: 未监听！"
        [[ "$port" == "3000" ]] && send_alert "端口 $port (Node.js) 未监听！"
    fi
done

# ------- 9. HTTPS 证书过期检查 -------
log "--- SSL 证书检查 ---"
CERT_DAYS=$(echo | openssl s_client -servername neondream.cn -connect neondream.cn:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | sed 's/notAfter=//' || echo "")
if [[ -n "$CERT_DAYS" ]]; then
    CERT_EXPIRY=$(date -d "$CERT_DAYS" +%s 2>/dev/null || echo "")
    NOW=$(date +%s)
    DAYS_LEFT=$(( (CERT_EXPIRY - NOW) / 86400 ))
    log "SSL 证书剩余天数: ${DAYS_LEFT}天"
    if [[ "$DAYS_LEFT" -lt 30 ]]; then
        send_alert "SSL 证书即将过期: 剩余 ${DAYS_LEFT} 天"
    fi
else
    log "SSL 证书检查失败（可能无 openssl）"
fi

log "========= 监控完成 =========\n"
