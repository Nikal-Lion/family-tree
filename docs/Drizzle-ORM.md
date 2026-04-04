### 📋 核心优势速览
在开始之前，用这个表格来快速了解为什么 Drizzle ORM 是 D1 的绝佳拍档[reference:0]：

| 优势维度 | 具体说明 |
| :--- | :--- |
| **极致轻量** | 纯 TypeScript 编写，几乎没有运行时开销，完美适配 Cloudflare Workers 对包体积的严苛限制[reference:1]。 |
| **原生驱动** | 官方提供 `drizzle-orm/d1` 驱动，直接与 `env.DB` 绑定，性能损耗几乎为零[reference:2]。 |
| **SQL 对等** | 语法与 SQL 高度一致，学习成本低，且能更清晰地理解 D1 作为 SQLite 数据库的特定行为[reference:3]。 |
| **类型安全** | 提供编译时的类型检查与强大的 TypeScript 智能提示，大幅减少运行时错误。 |
| **迁移便捷** | 通过 `drizzle-kit` CLI 工具，可以自动生成 SQL 迁移文件并轻松应用到 D1 数据库[reference:4]。 |

---

### 🚀 实战：从零搭建 Drizzle + D1
接下来，我们分步骤完成一个简单的用户表项目。

#### 第一步：环境准备与安装
1.  **安装 Wrangler CLI**：Cloudflare 官方命令行工具，用于管理 Workers 和 D1。
    ```bash
    npm install -g wrangler
    ```
2.  **登录 Cloudflare 账户**：
    ```bash
    wrangler login
    ```
3.  **创建 D1 数据库**：在终端中运行以下命令，并记下输出的 `database_id` 和 `database_name`。
    ```bash
    wrangler d1 create your-database-name
    ```
4.  **初始化项目**：创建一个新目录并进入。
    ```bash
    mkdir my-drizzle-d1-project && cd my-drizzle-d1-project
    npm init -y
    ```
5.  **安装依赖**：安装 Drizzle ORM 核心库和开发工具。
    ```bash
    npm install drizzle-orm
    npm install -D drizzle-kit
    ```

#### 第二步：配置文件设置
1.  **配置 `wrangler.jsonc`**：在项目根目录创建此文件，将 D1 数据库绑定到 Worker 中[reference:5][reference:6]。
    ```json
    {
      "$schema": "https://raw.githubusercontent.com/cloudflare/workers-sdk/main/packages/wrangler/config-schema.json",
      "name": "my-drizzle-d1-project",
      "main": "src/index.ts",
      "compatibility_date": "2025-01-01",
      "d1_databases": [
        {
          "binding": "DB",          // 代码中使用的变量名
          "database_name": "your-database-name",
          "database_id": "your-database-id",
          "migrations_dir": "./migrations"
        }
      ]
    }
    ```

2.  **配置 `drizzle.config.ts`**：这是 Drizzle Kit 工具的配置文件。**特别注意**：驱动名称必须使用 `d1-http`，这是配置 D1 迁移的关键[reference:7][reference:8]。
    ```typescript
    import { defineConfig } from 'drizzle-kit';

    export default defineConfig({
      schema: './src/db/schema.ts',
      out: './migrations',
      dialect: 'sqlite',
      driver: 'd1-http',
      dbCredentials: {
        wranglerConfigPath: './wrangler.jsonc',
        dbName: 'your-database-name',
      },
    });
    ```

#### 第三步：定义数据模型 (Schema)
在 `src/db/schema.ts` 文件中定义你的数据表。以下示例创建一张 `users` 表[reference:9]。
```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// 导出类型，以便在其他地方使用
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

#### 第四步：生成并执行数据库迁移
1.  **生成迁移 SQL**：根据你的 Schema 定义生成 SQL 迁移文件。
    ```bash
    npx drizzle-kit generate
    ```
2.  **应用到本地数据库**：先在本地环境验证迁移。
    ```bash
    npx wrangler d1 migrations apply your-database-name --local
    ```
3.  **应用到生产数据库**：确认无误后，应用到线上环境。
    ```bash
    npx wrangler d1 migrations apply your-database-name --remote
    ```

#### 第五步：在 Worker 中执行 CRUD 操作
现在，我们可以在 Worker 的入口文件 `src/index.ts` 中编写查询逻辑了[reference:10]。

1.  **初始化 Worker 与数据库连接**
    ```typescript
    // src/index.ts
    import { drizzle } from 'drizzle-orm/d1';
    import { users, NewUser } from './db/schema';
    import { eq } from 'drizzle-orm';

    export interface Env {
      DB: D1Database;
    }

    export default {
      async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const db = drizzle(env.DB);
        const url = new URL(request.url);

        // 执行不同的操作
        // ...

        return new Response('Operation completed', { status: 200 });
      }
    }
    ```

2.  **实现增删改查接口**
    可以在上述 `fetch` 函数内部，根据 URL 路径实现不同的数据库操作。

    *   **创建用户 (POST /users)**
        ```typescript
        if (request.method === 'POST' && url.pathname === '/users') {
          const body: NewUser = await request.json();
          const result = await db.insert(users).values(body).returning().get();
          return new Response(JSON.stringify(result), { status: 201 });
        }
        ```

    *   **查询所有用户 (GET /users)**
        ```typescript
        if (request.method === 'GET' && url.pathname === '/users') {
          const allUsers = await db.select().from(users).all();
          return new Response(JSON.stringify(allUsers));
        }
        ```

    *   **查询单个用户 (GET /users/:id)**
        ```typescript
        if (request.method === 'GET' && url.pathname.startsWith('/users/')) {
          const id = parseInt(url.pathname.split('/')[2]);
          const user = await db.select().from(users).where(eq(users.id, id)).get();
          if (!user) return new Response('Not Found', { status: 404 });
          return new Response(JSON.stringify(user));
        }
        ```

    *   **更新用户 (PUT /users/:id)**
        ```typescript
        if (request.method === 'PUT' && url.pathname.startsWith('/users/')) {
          const id = parseInt(url.pathname.split('/')[2]);
          const body = await request.json();
          const updatedUser = await db.update(users).set(body).where(eq(users.id, id)).returning().get();
          return new Response(JSON.stringify(updatedUser));
        }
        ```

    *   **删除用户 (DELETE /users/:id)**
        ```typescript
        if (request.method === 'DELETE' && url.pathname.startsWith('/users/')) {
          const id = parseInt(url.pathname.split('/')[2]);
          await db.delete(users).where(eq(users.id, id)).run();
          return new Response(null, { status: 204 });
        }
        ```

---

### 💎 核心要点总结

*   **使用 `d1-http` 驱动**：在 `drizzle.config.ts` 中，`driver` 必须设置为 `'d1-http'`，而不是 `'d1'`，这是让迁移工具正常工作的关键[reference:11][reference:12]。
*   **使用 `db.batch()` 处理事务**：D1 数据库**不支持** `BEGIN` / `COMMIT` 的 SQL 事务命令。执行多个需要原子性（要么全成功，要么全失败）的写操作时，必须使用 D1 的 `db.batch()` API。Drizzle 已完美支持，可直接调用[reference:13][reference:14]。
*   **严格区分迁移操作**：`drizzle-kit generate` 用于生成迁移文件，是生产环境推荐的方式。而 `drizzle-kit push` 应仅在快速原型开发的本地环境使用，禁止在生产环境使用[reference:15]。
*   **数据类型处理**：D1 没有原生的日期类型，建议将日期存储为整数（Unix 时间戳），如上述例子中使用 `mode: 'timestamp'`[reference:16]。