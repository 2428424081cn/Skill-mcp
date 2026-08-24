---
name: structured-output-json-schema
description: 大模型严格结构化输出 JSON Schema 约束设计与 Function Calling 容错修复机制。
---

# 大模型严格结构化 JSON 输出设计准则

## 1. Zod / Pydantic 严格 Schema 约束
定义 Schema 时，必须设置 `additionalProperties: false`，并将所有字段设为 `required`：

```ts
import { z } from 'zod';

export const DecisionResultSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'NEEDS_REVIEW']),
  confidenceScore: z.number().min(0).max(1),
  reasoning: z.string().min(10).describe('详细决策依据，不少于 10 字'),
  suggestedActions: z.array(z.string()).describe('推荐执行动作清单'),
}).strict();

export type DecisionResult = z.infer<typeof DecisionResultSchema>;
```

## 2. 容错与 JSON 修复流
大模型偶尔会输出包含 Markdown 代码块 (```json ... ```) 或尾随逗号。必须在反序列化层增加清洗容错：

```ts
export function safeParseJson<T>(rawText: string, schema: z.ZodType<T>): T {
  let cleaned = rawText.trim();
  // 去除 markdown 标记
  if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '');
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '');
  if (cleaned.endsWith('```')) cleaned = cleaned.replace(/\s*```$/, '');

  const parsed = JSON.parse(cleaned);
  return schema.parse(parsed);
}
```
