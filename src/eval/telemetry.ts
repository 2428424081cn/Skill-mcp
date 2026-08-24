// 调用日志 + 在线排名聚合（DESIGN Q4）。v2：SQLite（node:sqlite）为主后端，
// 路径以 .jsonl 结尾时走旧 JSONL 后端（兼容存量数据与迁移）。
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import type { InvocationLog, RankingStats } from "../types.ts";
import { appendJsonl, ensureDir, readJson, readJsonl, writeJson } from "../util.ts";
import { emptyStats, qualityScore, updateElo } from "./ranking.ts";

interface InvocationRow {
  ts: number; runId: string | null; skillKey: string; taskText: string; cluster: number;
  outcome: InvocationLog["outcome"]; latencyMs: number; costCents: number;
  rating: number | null; beatenBy: string | null; workflowId: string | null;
}

export class TelemetryStore {
  private logPath: string;
  private readonly legacyJsonl: boolean;
  private db: DatabaseSync | null = null;
  private insertStmt: { run(...args: (string | number | null)[]): unknown } | null = null;

  constructor(path: string) {
    this.logPath = path;
    if (path.endsWith(".jsonl")) {
      this.legacyJsonl = true;
      return;
    }
    this.legacyJsonl = false;
    ensureDir(dirname(path));
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invocations (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        runId TEXT NOT NULL,
        skillKey TEXT NOT NULL,
        taskText TEXT NOT NULL DEFAULT \'\',
        cluster INTEGER NOT NULL DEFAULT -1,
        outcome TEXT NOT NULL,
        latencyMs REAL NOT NULL DEFAULT 0,
        costCents REAL NOT NULL DEFAULT 0,
        rating INTEGER,
        beatenBy TEXT,
        workflowId TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_invocations_skill ON invocations(skillKey);
      CREATE INDEX IF NOT EXISTS idx_invocations_run ON invocations(runId);
    `);
    this.insertStmt = this.db.prepare(`INSERT INTO invocations
      (ts, runId, skillKey, taskText, cluster, outcome, latencyMs, costCents, rating, beatenBy, workflowId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  }

  log(entry: InvocationLog): void {
    if (this.legacyJsonl) {
      appendJsonl(this.logPath, entry);
      return;
    }
    this.insertStmt!.run(
      entry.ts, entry.runId, entry.skillKey, entry.taskText ?? "", entry.cluster ?? -1,
      entry.outcome, entry.latencyMs, entry.costCents,
      entry.rating ?? null, entry.beatenBy ?? null, entry.workflowId ?? null,
    );
  }

  all(): InvocationLog[] {
    if (this.legacyJsonl) return readJsonl<InvocationLog>(this.logPath);
    const rows = this.db!.prepare(`SELECT ts, runId, skillKey, taskText, cluster, outcome, latencyMs, costCents, rating, beatenBy, workflowId
      FROM invocations ORDER BY seq`).all() as unknown as InvocationRow[];
    return rows.map((r) => ({
      ts: r.ts, runId: r.runId ?? "", skillKey: r.skillKey, taskText: r.taskText,
      cluster: r.cluster, outcome: r.outcome, latencyMs: r.latencyMs, costCents: r.costCents,
      ...(r.rating !== null && r.rating !== undefined ? { rating: r.rating } : {}),
      ...(r.beatenBy ? { beatenBy: r.beatenBy } : {}),
      ...(r.workflowId ? { workflowId: r.workflowId } : {}),
    }));
  }

  recent(n = 100): InvocationLog[] {
    if (this.legacyJsonl) return this.all().slice(-n);
    const rows = this.db!.prepare(`SELECT ts, runId, skillKey, taskText, cluster, outcome, latencyMs, costCents, rating, beatenBy, workflowId
      FROM invocations ORDER BY seq DESC LIMIT ?`).all(n) as unknown as InvocationRow[];
    return rows.reverse().map((r) => ({
      ts: r.ts, runId: r.runId ?? "", skillKey: r.skillKey, taskText: r.taskText,
      cluster: r.cluster, outcome: r.outcome, latencyMs: r.latencyMs, costCents: r.costCents,
      ...(r.rating !== null && r.rating !== undefined ? { rating: r.rating } : {}),
      ...(r.beatenBy ? { beatenBy: r.beatenBy } : {}),
      ...(r.workflowId ? { workflowId: r.workflowId } : {}),
    }));
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.insertStmt = null;
    }
  }

  // v2 迁移：旧 JSONL -> SQLite（仅当 SQLite 目标为空时调用）
  static migrateFromJsonl(jsonlPath: string, sqlitePath: string): number {
    const entries = new TelemetryStore(jsonlPath).all();
    if (entries.length === 0) return 0;
    const target = new TelemetryStore(sqlitePath);
    for (const e of entries) target.log(e);
    target.close();
    return entries.length;
  }

  // 同一次调用的执行日志与反馈日志共享 runId：聚合时按 runId 去重（反馈为权威，后写覆盖先写），
  // 保证「一次调用只计一次」。无 runId 的历史日志逐条计数。
  private effective(logs: InvocationLog[]): InvocationLog[] {
    const idx = new Map<string, number>();
    const out: InvocationLog[] = [];
    for (const l of logs) {
      if (!l.runId) {
        out.push(l);
        continue;
      }
      const i = idx.get(l.runId);
      if (i === undefined) {
        idx.set(l.runId, out.length);
        out.push(l);
      } else {
        out[i] = l;
      }
    }
    return out;
  }

  // 只读重放聚合：wins/losses/elo 无法从日志推导，保持 0/1500（由 Ranker 维护）
  statsFor(key: string): RankingStats {
    const s = emptyStats();
    for (const l of this.effective(this.all())) {
      if (l.skillKey !== key) continue;
      if (l.outcome === "success") s.successes++;
      else if (l.outcome === "failure" || l.outcome === "timeout") s.failures++;
      s.totalLatencyMs += l.latencyMs;
      s.totalCostCents += l.costCents;
      if (l.ts > s.lastUsedAt) s.lastUsedAt = l.ts;
    }
    return s;
  }

  statsAll(): Record<string, RankingStats> {
    const out: Record<string, RankingStats> = {};
    for (const l of this.effective(this.all())) {
      const s = out[l.skillKey] ?? (out[l.skillKey] = emptyStats());
      if (l.outcome === "success") s.successes++;
      else if (l.outcome === "failure" || l.outcome === "timeout") s.failures++;
      s.totalLatencyMs += l.latencyMs;
      s.totalCostCents += l.costCents;
      if (l.ts > s.lastUsedAt) s.lastUsedAt = l.ts;
    }
    return out;
  }
}

export class Ranker {
  private stats: Record<string, RankingStats> = {};
  private clusterStats = new Map<string, RankingStats>(); // "skill|cN" -> 簇内统计
  private snapshotPath?: string;

  constructor(snapshotPath?: string) {
    this.snapshotPath = snapshotPath;
  }

  load(): void {
    if (!this.snapshotPath) return;
    const raw = readJson<{ stats?: Record<string, RankingStats>; clusters?: [string, RankingStats][] }>(this.snapshotPath, {});
    if (raw && typeof raw === "object" && raw.stats) {
      this.stats = raw.stats;
      this.clusterStats = new Map(raw.clusters ?? []);
    } else {
      // 旧快照格式：顶层直接是 skill -> stats
      this.stats = (raw as unknown as Record<string, RankingStats>) ?? {};
      this.clusterStats = new Map();
    }
  }

  save(): void {
    if (!this.snapshotPath) return;
    writeJson(this.snapshotPath, { stats: this.stats, clusters: [...this.clusterStats.entries()] });
  }

  // 缺失时返回默认（elo 1500）；返回的是存储对象，调用方可读不可假设引用
  statsFor(key: string): RankingStats {
    return this.stats[key] ?? emptyStats();
  }

  statsAll(): Record<string, RankingStats> {
    return this.stats;
  }

  // (skill, 任务簇) 维度的统计：供 Thompson/Wilson 做同簇比较（DESIGN Q4）
  clusterStatsFor(skillKey: string, cluster: number): RankingStats | undefined {
    if (cluster < 0) return undefined;
    return this.clusterStats.get(skillKey + "|c" + cluster);
  }

  private ensure(key: string): RankingStats {
    let s = this.stats[key];
    if (!s) {
      s = emptyStats();
      this.stats[key] = s;
    }
    return s;
  }

  private clusterEnsure(skillKey: string, cluster: number): RankingStats {
    const k = skillKey + "|c" + cluster;
    let s = this.clusterStats.get(k);
    if (!s) {
      s = emptyStats();
      this.clusterStats.set(k, s);
    }
    return s;
  }

  private applyCounters(s: RankingStats, log: InvocationLog): void {
    if (log.outcome === "success") s.successes++;
    else if (log.outcome === "failure" || log.outcome === "timeout") s.failures++;
    s.totalLatencyMs += log.latencyMs;
    s.totalCostCents += log.costCents;
    if (log.ts > s.lastUsedAt) s.lastUsedAt = log.ts;
  }

  private revertCounters(s: RankingStats, log: InvocationLog): void {
    if (log.outcome === "success") s.successes = Math.max(0, s.successes - 1);
    else if (log.outcome === "failure" || log.outcome === "timeout") s.failures = Math.max(0, s.failures - 1);
    s.totalLatencyMs = Math.max(0, s.totalLatencyMs - log.latencyMs);
    s.totalCostCents = Math.max(0, s.totalCostCents - log.costCents);
  }

  record(log: InvocationLog): void {
    const s = this.ensure(log.skillKey);
    this.applyCounters(s, log);
    // dueling / Elo 只在全局维度维护（簇内只维护成败计数，供 Thompson/Wilson）
    if (log.outcome === "success" && log.beatenBy) {
      const loser = this.ensure(log.beatenBy);
      s.wins++;
      loser.losses++;
      updateElo(s, loser);
    }
    if (log.cluster >= 0) this.applyCounters(this.clusterEnsure(log.skillKey, log.cluster), log);
  }

  // 反馈入账：撤销被反馈的那次执行（prev）已计入的自动计数，再以反馈结果为准重新入账。
  // 一次调用只计一次（skill_run/workflow_run 自动记账，skill_feedback 覆盖而不重复计数）；
  // prev 无法关联（找不到对应执行日志）时按一次新调用记录。
  recordFeedback(log: InvocationLog, prev?: InvocationLog | null): void {
    const s = this.ensure(log.skillKey);
    if (prev && prev.skillKey === log.skillKey) {
      this.revertCounters(s, prev);
      if (prev.cluster >= 0) this.revertCounters(this.clusterEnsure(prev.skillKey, prev.cluster), prev);
    }
    this.record(log);
  }

  quality(key: string): number {
    return qualityScore(this.statsFor(key));
  }

  impression(key: string): void {
    this.ensure(key).impressions++;
  }

  selection(key: string): void {
    this.ensure(key).selections++;
  }
}
