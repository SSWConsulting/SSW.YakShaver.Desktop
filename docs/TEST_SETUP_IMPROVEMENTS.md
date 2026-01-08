# 测试设置改进文档 (Test Setup Improvements)

## 📊 改进总结

| 优先级 | 问题 | 状态 |
|--------|------|------|
| 🔴 高 | Mock 设置导致数据库引用错误 | ✅ 已修复 |
| 🔴 高 | 混合使用 require/import | ✅ 已修复 |
| 🟡 中 | 测试清理时机不当 | ✅ 已修复 |
| 🟡 中 | 错误处理不完善 | ✅ 已修复 |
| 🟢 低 | 全局变量混乱 | ✅ 已修复 |

---

## 🎯 核心改进

### 改进 1: 移除有问题的 vi.mock (高优先级)

**❌ 旧方案 (有问题):**
```typescript
// setup-tests.ts
let testDbInstance: ReturnType<typeof createTestDb> | null = null;

beforeEach(() => {
  testDbInstance = createTestDb({ forceNew: true });
});

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return {
    ...actual,
    get db() {
      return testDbInstance?.db;  // ⚠️ 不可靠
    },
  };
});
```

**问题解释：**
- **ES6 模块是静态的**：当测试文件 `import { db } from './client'` 时，JavaScript 创建一个到 `db` 的绑定（binding）
- **Getter 不会被重新调用**：即使我们用 `get db()` 返回新值，已经导入的代码仍然持有旧的引用
- **类比**：就像你拍了一张照片，即使真人换了衣服，照片里的人还是穿着旧衣服

**✅ 新方案 (正确):**
```typescript
// shave-service.test.ts
describe("ShaveService", () => {
  let db: ReturnType<typeof createTestDb>["db"];

  beforeEach(() => {
    const testDb = createTestDb({ forceNew: true });
    db = testDb.db;  // ✅ 每次测试都获取新的数据库
  });

  // 使用局部变量 db，而不是从 client.ts 导入
});
```

**为什么这样更好：**
- ✅ **直接控制**：每个测试文件直接调用 `createTestDb()`，没有中间层
- ✅ **明确的生命周期**：可以清楚看到数据库何时创建、何时销毁
- ✅ **更简单**：不需要复杂的 mock 机制
- ✅ **类型安全**：TypeScript 能正确推断类型

---

### 改进 2: 使用顶层 import (高优先级)

**❌ 旧代码:**
```typescript
export function createTestDb(options: CreateTestDbOptions = {}) {
  // ... 在函数内部
  const { migrate } = require("drizzle-orm/better-sqlite3/migrator");  // ⚠️ 动态 require
  migrate(db, { migrationsFolder });
}
```

**问题：**
- **失去类型检查**：TypeScript 无法验证 migrate 函数的参数
- **违反模块化原则**：项目其他地方都用 import，这里用 require 不一致
- **打包问题**：某些打包工具（如 esbuild、webpack）可能处理 require 和 import 不同

**✅ 新代码:**
```typescript
// 文件顶部
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

export function createTestDb(options: CreateTestDbOptions = {}) {
  // 直接使用
  migrate(db, { migrationsFolder });
}
```

**好处：**
- ✅ **完整类型安全**：如果 API 改变，TypeScript 会立即报错
- ✅ **一致性**：整个项目使用相同的模块系统
- ✅ **更好的 IDE 支持**：自动补全、跳转到定义等功能完全可用

---

### 改进 3: beforeEach 而不是 afterEach (中优先级)

**❌ 旧模式:**
```typescript
afterEach(() => {
  db.delete(shaves).run();        // 测试后清理
  db.delete(videoSources).run();  // 如果测试失败，可能跳过
});
```

**问题情景：**
```typescript
it("test 1", () => {
  createShave({ title: "Test 1" });
  expect(1).toBe(2);  // ❌ 断言失败
  // afterEach 可能不运行，数据残留
});

it("test 2", () => {
  const shaves = getAllShaves();
  expect(shaves).toHaveLength(0);  // ❌ 失败！因为 test 1 的数据还在
});
```

**✅ 新模式:**
```typescript
beforeEach(() => {
  const testDb = createTestDb({ forceNew: true });
  db = testDb.db;  // 全新数据库，绝对干净
});
```

**为什么更好：**
- ✅ **绝对隔离**：每个测试开始时都是全新的空数据库
- ✅ **失败安全**：即使上一个测试失败，不影响下一个测试
- ✅ **更简单**：不需要手动删除每个表，创建新数据库就够了

**类比：**
- ❌ 旧方式：用完盘子后洗干净（但如果中途出错，盘子就是脏的）
- ✅ 新方式：每次用全新的盘子（永远干净）

---

### 改进 4: 添加错误处理 (中优先级)

**✅ 新代码:**
```typescript
if (testDbInstance && forceNew) {
  try {
    testDbInstance.sqlite.close();
  } catch (error) {
    console.warn("Error closing test database:", error);
  }
  testDbInstance = null;
}
```

**为什么重要：**
- **数据库可能已经关闭**：如果之前的测试已经关闭了数据库，再次关闭会报错
- **优雅降级**：记录警告但继续执行，而不是崩溃
- **更好的调试**：如果出问题，可以看到警告信息

---

## 🏗️ 新的测试架构

### 架构图

```
┌─────────────────────────────────────────┐
│  vitest.config.ts                       │
│  setupFiles: ['setup-tests.ts']        │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  setup-tests.ts (全局设置)              │
│  - afterAll: 关闭数据库                │
│  - 不再使用 vi.mock ✅                  │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  shave-service.test.ts                  │
│                                         │
│  beforeEach(() => {                     │
│    const testDb = createTestDb({        │
│      forceNew: true  // 全新数据库      │
│    });                                  │
│    db = testDb.db;  // 局部变量         │
│  });                                    │
│                                         │
│  it("test 1", () => {                   │
│    // 使用 db ...                       │
│  });                                    │
└─────────────────────────────────────────┘
```

### 数据流

```
测试 1 开始
   ↓
createTestDb({ forceNew: true })
   ↓
创建新的 :memory: 数据库
   ↓
运行 migrations (创建表结构)
   ↓
返回 { db, sqlite }
   ↓
测试 1 使用这个 db
   ↓
测试 1 结束
   ↓
测试 2 开始
   ↓
createTestDb({ forceNew: true })  ← 关闭旧数据库，创建新的
   ↓
... 循环
```

---

## 📚 核心概念解释

### 什么是 SQLite?

**简单类比：** SQLite 就像一个 Excel 文件
- **普通 SQLite 数据库** = 存在硬盘上的 `.sqlite` 文件
- **`:memory:` 数据库** = 临时存在内存里，程序关闭就消失

**测试为什么用 `:memory:`?**
- ✅ **非常快**：内存操作比硬盘快 100+ 倍
- ✅ **自动清理**：测试结束，数据自动消失
- ✅ **不污染真实数据**：生产数据库文件完全不受影响

### 什么是 Drizzle ORM?

**ORM (Object-Relational Mapping)** = 对象关系映射

**不用 ORM (原始 SQL):**
```typescript
const result = db.run(`
  INSERT INTO shaves (id, title, videoEmbedUrl)
  VALUES ('123', 'My Video', 'https://...')
`);
```

**用 Drizzle ORM:**
```typescript
const result = db.insert(shaves).values({
  id: '123',
  title: 'My Video',
  videoEmbedUrl: 'https://...'
});
```

**好处：**
- ✅ **类型安全**：如果拼错字段名，TypeScript 报错
- ✅ **防止 SQL 注入**：Drizzle 自动处理参数转义
- ✅ **自动补全**：IDE 提示所有可用字段

### 什么是 Migration (迁移)?

**类比：** 数据库的"版本历史"

```
Version 1 (0000_init.sql):
  创建 shaves 表 (3 个字段)

Version 2 (0001_schema_v2.sql):
  添加 videoSources 表
  添加 videoFiles 表
  在 shaves 表添加 videoSourceId 字段
```

**为什么需要 Migration?**
- ✅ **可追溯**：知道数据库结构何时、如何变化
- ✅ **可回滚**：如果新版本有问题，可以回到旧版本
- ✅ **团队协作**：所有开发者运行相同的 migrations，数据库结构一致

---

## 🔧 如何使用新的测试模式

### 模板代码

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../client";
import { yourTable } from "../schema";
import { yourService } from "./your-service";

describe("YourService", () => {
  let db: ReturnType<typeof createTestDb>["db"];

  beforeEach(() => {
    const testDb = createTestDb({ forceNew: true });
    db = testDb.db;
  });

  it("should do something", () => {
    // 使用 db 进行测试
    const result = yourService.create({ name: "test" });
    expect(result).toBeDefined();
  });
});
```

### 关键点

1. **导入 `createTestDb`**，不要导入 `db`
2. **声明局部变量** `let db`
3. **在 beforeEach 中赋值** `db = testDb.db`
4. **使用 `forceNew: true`** 确保每次都是新数据库

---

## ✅ 验证改进

### 运行测试

```bash
npm test
```

### 预期结果

```
✓ ShaveService > createShave > should create a new shave
✓ ShaveService > getShaveById > should retrieve a shave by ID
✓ VideoSourceService > createVideoSource > should create a new video source
...
```

### 测试隔离验证

```typescript
it("test 1", () => {
  createShave({ title: "Shave 1" });
  expect(getAllShaves()).toHaveLength(1);
});

it("test 2", () => {
  // 即使 test 1 创建了数据，这里应该是空的
  expect(getAllShaves()).toHaveLength(0);  // ✅ 通过
});
```

---

## 🎓 学习要点

### 对于不熟悉 Electron/Drizzle/SQLite 的开发者

1. **SQLite 是轻量级数据库**
   - 就像一个可以用 SQL 查询的文件
   - `:memory:` 模式让测试非常快

2. **Drizzle 让数据库操作类型安全**
   - 不用写原始 SQL 字符串
   - TypeScript 检查所有数据库操作

3. **测试隔离非常重要**
   - 每个测试应该独立运行
   - 一个测试失败不应该影响其他测试

4. **避免复杂的 Mock**
   - 如果可以用真实（但隔离的）依赖，就不要 mock
   - `:memory:` 数据库非常快，不需要 mock

### 最佳实践

✅ **DO (推荐):**
- 每个测试创建全新数据库
- 使用 `beforeEach` 设置干净状态
- 使用顶层 import 而不是 require
- 添加错误处理

❌ **DON'T (避免):**
- 在测试间共享数据库状态
- 依赖测试执行顺序
- 使用复杂的 mock 替代简单的真实对象
- 在 `afterEach` 中清理（可能因失败跳过）

---

## 📝 总结

| 方面 | 旧方案 | 新方案 | 改进 |
|------|--------|--------|------|
| **数据库获取** | 通过 vi.mock 的 getter | 直接调用 createTestDb() | ✅ 更可靠 |
| **模块导入** | 混合 import/require | 统一使用 import | ✅ 类型安全 |
| **测试隔离** | afterEach 清理 | beforeEach 新建 | ✅ 失败安全 |
| **错误处理** | 无 | try-catch | ✅ 更健壮 |
| **代码复杂度** | 复杂 mock 逻辑 | 简单直接 | ✅ 更易维护 |

**核心理念：** 
- 🎯 **简单胜于复杂** (Simple is better than complex)
- 🎯 **显式胜于隐式** (Explicit is better than implicit)
- 🎯 **隔离胜于共享** (Isolation is better than shared state)
