#!/usr/bin/env bash
# Allow Qchat web/API/LiveKit through UFW (host processes are blocked; Docker
# published ports often work without these rules).
set -euo pipefail
sudo ufw allow 80/tcp comment 'Qchat HTTP redirect'
sudo ufw allow 443/tcp comment 'Qchat HTTPS'
sudo ufw allow 7443/tcp comment 'LiveKit WSS via nginx'
sudo ufw allow 3000/tcp comment 'Qchat web'
sudo ufw allow 8080/tcp comment 'Qchat API'
sudo ufw allow 7880/tcp comment 'LiveKit signal'
sudo ufw allow 7881/tcp comment 'LiveKit RTC TCP'
sudo ufw allow 50000:50100/udp comment 'LiveKit RTC UDP'
sudo ufw allow 3478/tcp comment 'Coturn TURN TCP'
sudo ufw allow 3478/udp comment 'Coturn TURN UDP'
sudo ufw allow 49160:49200/udp comment 'Coturn relay UDP'
sudo ufw status numbered
