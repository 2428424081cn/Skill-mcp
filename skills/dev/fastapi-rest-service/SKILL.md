---
name: fastapi-rest-service
description: FastAPI / Pydantic v2 高性能异步后端开发指南。涵盖依赖注入、异步数据库连接池与统一响应封装。
---

# FastAPI 异步后端架构规范指南

遵循现代 Python 3.11+ 异步开发标准与 Pydantic v2 校验模式。

## 目录组织标准
```text
app/
├── api/v1/endpoints/       # 路由层
├── core/config.py          # 环境变量与配置
├── models/                 # 数据库 ORM 模型
├── schemas/                # Pydantic 校验 Schema
└── services/               # 核心业务逻辑
```
