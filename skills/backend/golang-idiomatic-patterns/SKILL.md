---
name: golang-idiomatic-patterns
description: Go (Golang) 原生工程惯用法：错误链包装、Context 生命周期、Goroutine 泄漏防御与表驱动测试。
---

# Go (Golang) 官方原生工程化规范

## 1. 错误包装与解构铁律
- **必须使用 `%w` 包装上下文**：`fmt.Errorf("find user id=%d: %w", id, err)`。
- **判断特定哨兵错误**：必须使用 `errors.Is(err, sql.ErrNoRows)`，严禁 `err == sql.ErrNoRows`。
- **类型断言自定义错误**：必须使用 `errors.As(err, &customErr)`。

## 2. Context 传递与生命周期
- 函数的第一个参数始终为 `ctx context.Context`。
- 绝不在结构体内部存储 Context，必须随方法调用链传递。
- 所有的外部网络调用、DB 查询必须接收并响应 `ctx.Done()`。

## 3. 并发安全与 Goroutine 泄漏防护
- **启动 Goroutine 前必须明确其退出机制**（通过 Context 取消或 Channel 关闭信号）。
- **Channel 必须由发送方（Producer）关闭**，严禁接收方关闭。

```go
func ProcessItems(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(10) // 严格限制最大并发工作协程数

    for _, item := range items {
        item := item // 防止闭包变量逃逸共享
        g.Go(func() error {
            return doWork(ctx, item)
        })
    }
    return g.Wait()
}
```
