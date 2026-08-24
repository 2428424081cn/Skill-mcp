// Git Commit 规范自动化校验器
export function validateCommit(msg: string): { valid: boolean; error?: string } {
  const pattern = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w\-\.]+\))?!?: .+/;
  const lines = msg.trim().split('\n');
  const header = lines[0];
  if (!pattern.test(header)) {
    return {
      valid: false,
      error: "Header 格式不符合规范: <type>(<optional scope>): <subject>。允许的 type: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert",
    };
  }
  if (header.length > 72) {
    return { valid: false, error: "Header 长度超过 72 字符限制（当前 " + header.length + " 字符）" };
  }
  return { valid: true };
}
