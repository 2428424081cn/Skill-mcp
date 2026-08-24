// 三层权限 broker：skill 声明（manifest.permissions）∩ 管理策略（allow/deny/ask 规则）∩ 会话授权（grant）
// 默认拒绝：写文件 / 网络 / 外部工具 / env 无规则命中时默认拒绝；ask 命中返回待批准清单（两段式 HITL，DESIGN Q6）
import type { GrantToken, PermissionSet } from "../types.ts";
import { uid } from "../util.ts";

export type PolicyAction = "allow" | "deny" | "ask";

export interface PolicyRule {
  action: PolicyAction;
  permission: "fsRead" | "fsWrite" | "network" | "tools" | "env";
  pattern: string;
}

export interface PolicyConfig {
  rules?: PolicyRule[];
  defaultMutating?: "ask" | "deny" | "allow";
  defaultNetwork?: "ask" | "deny" | "allow";
}

export interface PermissionEvaluation {
  allowed: PermissionSet;
  denied: string[];
  asks: { permission: string; detail: string }[];
}

const LIST_PERMISSIONS = ["fsRead", "fsWrite", "network", "tools", "env"] as const;
type ListPermission = (typeof LIST_PERMISSIONS)[number];

// 模式匹配："*" 全匹配；其余按前缀匹配且要求落在段边界（防 /tmp 误配 /tmp2、防域名后缀攻击）
export function patternMatches(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  if (pattern === value) return true;
  if (!value.startsWith(pattern)) return false;
  if (pattern.endsWith("/") || pattern.endsWith(".") || pattern.endsWith(":")) return true;
  const next = value[pattern.length];
  return next === "/" || next === ":";
}

export class PermissionBroker {
  private policy: PolicyConfig;

  constructor(policy: PolicyConfig = {}) {
    this.policy = policy;
  }

  // 三层求交：先按管理策略过滤声明，再做会话授权交集
  evaluate(declared: PermissionSet, sessionGrants?: Partial<PermissionSet>): PermissionEvaluation {
    const allowed: PermissionSet = { ...declared };
    const denied: string[] = [];
    const asks: { permission: string; detail: string }[] = [];
    const rules = this.policy.rules ?? [];

    for (const perm of LIST_PERMISSIONS) {
      const entries = allowed[perm] ?? [];
      if (entries.length === 0) continue;
      const kept: string[] = [];
      for (const value of entries) {
        const rule = rules.find((r) => r.permission === perm && patternMatches(r.pattern, value));
        const action = rule ? rule.action : this.defaultAction(perm, declared);
        switch (action) {
          case "allow":
            kept.push(value);
            break;
          case "deny":
            denied.push(`${perm}: ${value}`);
            break;
          case "ask":
            // 会话授权（grant token）已覆盖 -> 视为已批准，HITL 第二段不再重复询问
            if (this.grantCovers(sessionGrants?.[perm], value)) {
              kept.push(value);
            } else {
              asks.push({ permission: perm, detail: `${perm}: ${value}` });
            }
            break;
        }
      }
      allowed[perm] = kept;
    }

    // 会话授权交集：未在 grant 中出现（且 grant 无 "*"）的条目从 allowed 移除
    this.applyGrantIntersection(allowed, sessionGrants);

    return { allowed, denied, asks };
  }

  // 无规则命中时的默认动作
  private defaultAction(perm: ListPermission, declared: PermissionSet): PolicyAction {
    switch (perm) {
      case "fsRead":
        return "allow";
      case "fsWrite":
        // fsWrite 默认走 defaultMutating（默认 deny）；declared.mutating === true 且无显式 allow
        // 规则时同样按 defaultMutating 处理 —— 确保写操作不会被静默放行
        return this.policy.defaultMutating ?? "deny";
      case "network":
        return this.policy.defaultNetwork ?? "deny";
      case "tools":
      case "env":
        return "deny";
    }
  }

  // grant 是否覆盖某条权限条目："*" 或精确匹配
  private grantCovers(granted: string[] | undefined, value: string): boolean {
    return !!granted && (granted.includes("*") || granted.includes(value));
  }

  // 会话授权（或 grant token）交集：granted 中缺失（且无 "*"）的条目被移除
  private applyGrantIntersection(allowed: PermissionSet, grants?: Partial<PermissionSet>): void {
    if (grants === undefined) return;
    for (const perm of LIST_PERMISSIONS) {
      const granted = grants[perm];
      if (granted === undefined || granted.length === 0) {
        allowed[perm] = [];
        continue;
      }
      if (granted.includes("*")) continue;
      allowed[perm] = (allowed[perm] ?? []).filter((v) => granted.includes(v));
    }
  }

  // 签发两段式 HITL 授权令牌（先批后跑）
  issueGrant(skillKey: string, granted: Partial<PermissionSet>, ttlMs = 30 * 60 * 1000): GrantToken {
    return { id: uid(), skillKey, granted, expiresAt: Date.now() + ttlMs };
  }

  // 校验令牌：无令牌 / 过期 / 技能不匹配 -> allowed=false 并在 denied 中说明；否则与会话授权相同的交集逻辑
  // expectedSkillKey 由调用方（tools 层）传入，用于校验令牌归属
  checkGrant(token: GrantToken | undefined, declared: PermissionSet, expectedSkillKey?: string): { allowed: boolean; denied: string[] } {
    if (!token) return { allowed: false, denied: ["no grant token provided"] };
    if (token.expiresAt < Date.now()) return { allowed: false, denied: ["grant token expired"] };
    if (expectedSkillKey !== undefined && token.skillKey !== expectedSkillKey) {
      return { allowed: false, denied: [`grant token is for "${token.skillKey}", expected "${expectedSkillKey}"`] };
    }
    const allowed: PermissionSet = { ...declared };
    this.applyGrantIntersection(allowed, token.granted);
    const denied: string[] = [];
    for (const perm of LIST_PERMISSIONS) {
      const granted = token.granted[perm];
      if (granted && granted.includes("*")) continue;
      for (const v of declared[perm] ?? []) {
        if (!granted || !granted.includes(v)) denied.push(`${perm}: ${v}`);
      }
    }
    return { allowed: denied.length === 0, denied };
  }

  // "*" 或前缀匹配
  isAllowed(set: PermissionSet, permission: keyof PermissionSet, value: string): boolean {
    const list = set[permission];
    if (!Array.isArray(list)) return false;
    return list.some((p) => patternMatches(p, value));
  }
}
