---
name: openapi-swagger-gen
description: OpenAPI 3.0 / Swagger 规范生成指南。标准定义 Path, Parameters, RequestBody 与 Responses。
---

# OpenAPI 3.0 接口契约标准指南

标准结构速查：
```yaml
openapi: 3.0.0
info:
  title: Sample API
  version: 1.0.0
paths:
  /users:
    get:
      summary: List users
      responses:
        '200':
          description: OK
```
