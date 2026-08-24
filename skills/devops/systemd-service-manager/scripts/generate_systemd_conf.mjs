const name = process.argv[2] || "my-app";
const exec = process.argv[3] || "/usr/bin/node /opt/app/src/main.ts";

console.log(`# /etc/systemd/system/${name}.service
[Unit]
Description=${name} background service
After=network.target

[Service]
Type=simple
User=node
WorkingDirectory=/opt/app
ExecStart=${exec}
Restart=always
RestartSec=5s
Environment=NODE_ENV=production
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
`);
