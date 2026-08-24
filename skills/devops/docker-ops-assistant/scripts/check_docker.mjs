import { execSync } from "node:child_process";

try {
  const out = execSync("docker ps --format \"table {{.ID}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Names}}\"", { encoding: "utf8" });
  console.log("=== Docker 容器运行状态 ===\n" + out);
} catch (e) {
  console.log("⚠️ Docker 未运行或未安装在当前系统路径中。");
}
