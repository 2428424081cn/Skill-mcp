---
name: vue3-pinia-composition
description: Vue 3 组合式 API (<script setup>) 与 Pinia 状态管理架构规范与响应式丢失防御。
---

# Vue 3 组合式 API 与 Pinia 架构规范

## 1. 响应式铁律 (Reactivity Rules)

1. **优先使用 `ref()`**：对于基本类型和普通对象，优先统一使用 `ref()`，避免 `reactive()` 在解构赋值时丢失响应性。
2. **禁止直接解构 Store**：Pinia Store 状态必须使用 `storeToRefs()` 解构，Actions 可直接解构：
   ```ts
   const userStore = useUserStore();
   // ❌ 错误：会破坏响应性
   const { profile, isLoggedIn } = userStore;
   // ✅ 正确：保持响应性
   const { profile, isLoggedIn } = storeToRefs(userStore);
   const { login, logout } = userStore; // actions 保持引用
   ```
3. **函数式 Setup Store**：Pinia 推荐采用与 `<script setup>` 风格一致的函数式写法：

```ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useUserStore = defineStore('user', () => {
  const token = ref<string | null>(null);
  const user = ref<UserProfile | null>(null);

  const isAuthenticated = computed(() => !!token.value);

  async function fetchCurrentUser() {
    if (!token.value) return;
    user.value = await api.getUser();
  }

  function clearSession() {
    token.value = null;
    user.value = null;
  }

  return { token, user, isAuthenticated, fetchCurrentUser, clearSession };
});
```

## 2. 组合式函数 (Composable) 规范
- 命名统一以 `use...` 开头（如 `usePagination.ts`, `useWebSocket.ts`）。
- 总是返回纯对象，包含响应式 `Ref` 与操作函数。
- 必须处理组件卸载生命周期，在 `onUnmounted()` 中清理定时器与事件监听器。
