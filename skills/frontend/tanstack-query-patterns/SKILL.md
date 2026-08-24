---
name: tanstack-query-patterns
description: TanStack Query v5 (React Query) 缓存架构、Query Key 工厂、乐观更新与 SSR 预取模式。
---

# TanStack Query v5 (React Query) 最佳实践

## 1. 统一 Query Key Factory 模式
绝不在组件内随意手写散装数组作为 Query Key，必须通过统一工厂对象维护，确保类型安全与精准缓存失效：

```ts
export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (filters: UserFilters) => [...userKeys.lists(), { filters }] as const,
  details: () => [...userKeys.all, 'detail'] as const,
  detail: (id: string) => [...userKeys.details(), id] as const,
};
```

## 2. 乐观更新 (Optimistic Updates) 标准模式
在执行点赞、修改、删除等操作时，先立即更新本地 UI，若网络失败则自动回滚：

```ts
export function useUpdateTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateTodoApi,
    onMutate: async (newTodo) => {
      // 1. 取消正在发起的并发请求，防止覆盖乐观状态
      await queryClient.cancelQueries({ queryKey: todoKeys.detail(newTodo.id) });
      // 2. 备份快照
      const previousTodo = queryClient.getQueryData<Todo>(todoKeys.detail(newTodo.id));
      // 3. 乐观写入新数据
      queryClient.setQueryData<Todo>(todoKeys.detail(newTodo.id), (old) => ({ ...old, ...newTodo }));
      return { previousTodo };
    },
    onError: (err, newTodo, context) => {
      // 4. 发生错误时回滚到快照
      if (context?.previousTodo) {
        queryClient.setQueryData(todoKeys.detail(newTodo.id), context.previousTodo);
      }
    },
    onSettled: (data, err, newTodo) => {
      // 5. 最终刷新服务端最新数据
      queryClient.invalidateQueries({ queryKey: todoKeys.detail(newTodo.id) });
    },
  });
}
```
