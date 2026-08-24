const domain = process.argv[2] || "api.example.com";
const port = process.argv[3] || "3000";

console.log(`server {
    listen 80;
    server_name ${domain};

    # Gzip 压缩
    gzip on;
    gzip_types text/plain application/json text/css application/javascript;
    gzip_min_length 1024;

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`);
