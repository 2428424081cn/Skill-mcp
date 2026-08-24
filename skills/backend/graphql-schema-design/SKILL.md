---
name: graphql-schema-design
description: GraphQL API 设计准则：Relay 游标分页、DataLoader 批量防 N+1 查询与 Schema 优雅演进。
---

# GraphQL Schema 设计与 DataLoader 性能优化

## 1. Relay 规范游标分页 (Cursor Pagination)
大数据量分页必须采用 Connection / Edge 规范，禁止使用脆弱的 Offset 分页：

```graphql
type Query {
  users(first: Int, after: String): UserConnection!
}

type UserConnection {
  edges: [UserEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type UserEdge {
  cursor: String!
  node: User!
}

type PageInfo {
  hasNextPage: Boolean!
  endCursor: String
}
```

## 2. 强制使用 DataLoader 解决 N+1 问题
在 GraphQL 解析器遍历列表子字段时，严禁在 Resolver 中发起单条 SQL 查询，必须使用 DataLoader 批处理缓存：

```ts
import DataLoader from 'dataloader';

export function createUserLoader(db: Database) {
  return new DataLoader<string, User>(async (userIds) => {
    const users = await db.users.findMany({ where: { id: { in: [...userIds] } } });
    const map = new Map(users.map(u => [u.id, u]));
    return userIds.map(id => map.get(id) || null);
  });
}
```
