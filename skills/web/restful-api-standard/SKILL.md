---
name: restful-api-standard
namespace: web
version: 1.0.0
skillType: rule
description: 企业级 RESTful API 设计准则
---

# 企业级 RESTful API 设计准则

在生成任何 API 接口、路由定义与控制器时，AI 必须严格执行以下设计标准。

## 一、 URL 命名与路由层级
1. **全名词复数**：使用资源复数名词，严禁在 URL 中出现动词（动词由 HTTP Method 表达）。
   - ❌ `/api/getUserInfo` / `/api/deleteOrder`
   - ✅ `GET /api/v1/users/{id}` / `DELETE /api/v1/orders/{id}`
2. **层级从属表达**：子资源嵌套在父资源之后。
   - ✅ `GET /api/v1/users/{userId}/orders`
3. **Kebab-Case**：URL 路径全小写并用连字符连接（如 `/api/v1/payment-methods`）。

## 二、 HTTP 谓词与状态码契约
- **`GET`**：安全且幂等，查询资源。`200 OK`
- **`POST`**：创建资源。成功返回 `201 Created` + `Location` 头。
- **`PUT`**：全量替换（幂等）。`200 OK` 或 `204 No Content`
- **`PATCH`**：局部更新。`200 OK`
- **`DELETE`**：删除资源（幂等）。成功返回 `204 No Content` 或 `200 OK`
- **错误状态码**：
  - `400 Bad Request`（参数格式错误）
  - `401 Unauthorized`（未认证/Token 失效）
  - `403 Forbidden`（已认证但无权限）
  - `404 Not Found`（资源不存在）
  - `409 Conflict`（唯一约束/状态机冲突）
  - `422 Unprocessable Entity`（业务逻辑校验失败）

## 三、 统一响应体信封 (Envelope)
```json
{
  "code": 0,
  "message": "success",
  "data": { ... },
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 100
  },
  "traceId": "c98a1f87-6e42-4b2a"
}
```
