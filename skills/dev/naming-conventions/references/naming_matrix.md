# 命名准则速查矩阵 (Naming Style Guide Matrix)

## 1. 布尔变量速查
| 意图 | 推荐前缀 | 优秀命名示例 |
| :--- | :--- | :--- |
| 是否处于某种状态 | `is` | `isModalVisible`, `isOnline`, `isConnecting` |
| 是否拥有某种属性 | `has` | `hasUnsavedChanges`, `hasDiscount` |
| 是否应该执行动作 | `should` | `shouldAutoScroll`, `shouldFetchNextPage` |
| 是否具备某种能力 | `can` | `canUserDelete`, `canSubmitForm` |

## 2. 异步与 Promise 命名
- 返回 Promise 的函数使用一般动词命名：`fetchUser()`, `createOrder()`
- 变量持有 Promise 时可后缀：`const userPromise = fetchUser();`
