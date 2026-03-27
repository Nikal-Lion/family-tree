# 存储方案升级需求文档（PRD）- SQLite 第一期方案

## 1. 背景与问题

当前电子族谱系统使用浏览器 `localStorage` 存储所有数据，存在以下局限性：

- **单设备绑定**：数据仅保存在当前浏览器的当前设备中，换设备或换浏览器后数据无法同步。
- **分享困难**：无法方便地将族谱数据分享给其他家族成员，需手动复制或导出 JSON 文件，操作繁琐。
- **备份风险**：用户清空浏览器缓存或更换设备时，数据容易丢失。
- **协作障碍**：多人无法同时编辑同一份族谱，难以实现家族共同维护。
- **数据容量小**：localStorage 通常仅 5-10MB，随着族谱成员增多及后续多媒体功能（照片、轨迹文件）扩展，容量瓶颈明显。

因此，需要升级存储方案，采用更可靠、容量更大、支持复杂查询的本地数据库，并为后续云端同步打下基础。

---

## 2. 目标

- 采用 **SQLite** 作为第一期本地存储方案，提升数据容量、查询性能和可靠性。
- 保留导入/导出功能，便于用户分享数据。
- 为后续云端同步（第二期）提供标准化数据接口。
- 保持离线可用，数据完全存储于用户设备。

---

## 3. 方案选型：SQLite 在前端的实现方式

### 3.1 技术方案对比

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| SQL.js | 基于 WebAssembly 的 SQLite 实现 | 完全前端运行，无需后端；支持标准 SQL；兼容性好 | 数据库文件整体加载到内存，大数据量时占用内存高；写入需重新导出文件 |
| OPFS + SQLite3（原生） | 使用 Origin Private File System（OPFS） + 原生 SQLite3（通过 wasm 或 Worker） | 支持持久化文件存储，增量写入，性能更好 | 较新的 API（需 Chrome 102+）；实现复杂 |
| 轻量级包装库（如 `sqlite-wasm`） | 基于 SQLite 官方 WASM 构建 | 官方支持，稳定性高 | 仍需处理文件持久化 |

### 3.2 推荐方案：SQL.js（适合第一期）

- **理由**：实现简单，兼容性好（所有现代浏览器），无需额外配置，单个 js 文件即可运行。
- **数据持久化**：将整个数据库文件作为 ArrayBuffer 存储在 IndexedDB 或 OPFS 中，或每次保存时导出并存储。
- **性能**：对于普通族谱（数千人），内存占用可接受。

### 3.3 备用方案：官方 SQLite WASM + OPFS（第二期可升级）

- 当需要更大容量、更高性能时，可无缝迁移。

---

## 4. 功能需求

### 4.1 SQLite 数据库设计

#### 表：members
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 成员唯一 ID |
| name | TEXT NOT NULL | 姓名 |
| parent_id | INTEGER | 父亲 ID，可为空，外键关联 id |
| gender | TEXT | 性别（男/女） |
| birth_year | TEXT | 出生年份（可选，预留） |
| death_year | TEXT | 逝世年份（可选） |
| biography | TEXT | 生平简介（可选） |
| created_at | INTEGER | 创建时间戳 |
| updated_at | INTEGER | 更新时间戳 |

#### 表：metadata
| 字段 | 类型 | 说明 |
|------|------|------|
| key | TEXT PRIMARY KEY | 配置键 |
| value | TEXT | 配置值 |

存储系统信息，如 `next_id`（兼容原有逻辑）、`last_sync_time` 等。

#### 表：media（预留，第二期）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 媒体 ID |
| member_id | INTEGER | 关联成员 ID |
| type | TEXT | image/video/audio |
| url | TEXT | 文件路径或 blob key |

### 4.2 核心操作

| 功能 | 描述 |
|------|------|
| 初始化数据库 | 首次加载时检查数据库是否存在，若不存在则创建表结构，插入示例数据（可选） |
| 增 | 执行 INSERT 语句，返回新 ID，更新内存中的 next_id |
| 删 | 执行 DELETE，支持级联删除后代（需递归或外键约束） |
| 改 | 执行 UPDATE，更新 updated_at 时间戳 |
| 查 | 使用 SELECT 语句，支持按 ID、姓名、父亲等条件查询，用于构建树结构 |
| 树数据生成 | 通过一次查询获取所有成员，前端构建树结构（与 localStorage 版本类似） |

### 4.3 导入导出

#### 导出功能
- 将整个 SQLite 数据库导出为 `.sqlite` 或 `.db` 文件（二进制），用户可下载保存。
- 可选导出 JSON 格式（与旧版兼容）。

#### 导入功能
- 用户选择 `.sqlite` 文件，系统读取后替换当前数据库（提示确认）。
- 支持导入 JSON 文件，系统解析后插入 SQLite 表中。

#### 分享链接（同原方案）
- 生成压缩后的 JSON 数据（使用 `lz-string`），放入 URL hash，对方打开后自动导入。

### 4.4 数据持久化

- 每次增删改操作后，调用 SQL.js 的 `export` 方法获取数据库二进制内容。
- 将二进制内容存储到 IndexedDB 中（使用 `idb-keyval` 或 `localforage`）。
- 页面初始化时，从 IndexedDB 读取并加载到内存。

### 4.5 离线模式与性能优化

- 所有 SQL 操作均在内存中完成，速度快。
- 写操作后持久化到 IndexedDB 是异步的，不阻塞 UI。
- 支持批量操作（如导入），合并多次写入。

---

## 5. 数据模型（SQL 定义）

```sql
CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER,
    gender TEXT CHECK(gender IN ('男', '女')) DEFAULT '男',
    birth_year TEXT,
    death_year TEXT,
    biography TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (parent_id) REFERENCES members(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- 初始化 next_id（如果原有逻辑需要）
INSERT OR IGNORE INTO metadata (key, value) VALUES ('next_id', '100');
```
## 6. 与原有系统的兼容性

- 保留原有 `localStorage` 读取能力：若用户首次使用新版本，可检测 localStorage 中是否有数据，提示导入到 SQLite。
- 提供“导出 SQLite”和“导出 JSON”两种格式，方便用户备份。

---

## 7. 交互流程

### 7.1 初始化
1. 页面加载，检查 IndexedDB 中是否有数据库文件。
2. 若无，创建空数据库，插入示例数据（可选）。
3. 加载数据库到内存（SQL.js），初始化表结构。

### 7.2 成员管理
1. 添加成员：执行 INSERT，获取新 ID，更新内存，异步持久化。
2. 编辑/删除：执行相应 SQL，更新 `updated_at`。
3. 所有操作后刷新前端 UI（树图、列表）。

### 7.3 导入导出
- 导出：调用 `db.export()` 获取二进制，使用 `Blob` 下载。
- 导入：读取文件为 ArrayBuffer，`new SQL.Database(buffer)` 替换当前数据库，保存到 IndexedDB，刷新界面。

---

## 8. 技术实现要点

### 8.1 使用 SQL.js
- 引入 `sql.js` 的 WASM 版本（如 `https://sql.js.org/dist/sql-wasm.js`）。
- 初始化：
  ```javascript
  let db = new SQL.Database();
  // 从 IndexedDB 加载数据
  const data = await getFromIDB();
  if (data) db = new SQL.Database(data);
  else initTables();
- 执行 SQL：
```javascript
  db.run("INSERT INTO members (name) VALUES (?)", ["张三"]);
```
- 查询
```javascript
  const res = db.exec("SELECT * FROM members");
```

### 8.2

- 使用 `idb-keyval` 简化操作：
```javascript
import { get, set } from 'idb-keyval';
const saveDB = async () => {
  const data = db.export();
  await set('familytree_db', data);
};
```

### 8.3 树构建优化
- 一次性查询所有成员：`SELECT * FROM members ORDER BY id`。
- 前端构建父子映射，与旧版相同。

### 8.4 删除级联
- 外键约束：`ON DELETE SET NULL`，删除父亲后子成员 `parent_id` 置空。
- 如需完全删除后代，可递归查询或使用 `WITH RECURSIVE` CTE（SQL.js 支持），前端实现更简单。

---

## 9. 安全与隐私

- 所有数据仅存于用户设备，不上传任何服务器。
- 导出文件由用户自行保管，系统不参与传输。
- 后续云端同步需用户明确授权。

---

## 10. 实施计划

| 阶段 | 任务 | 工作量 |
|------|------|--------|
| 1 | 集成 SQL.js，实现初始化、增删改查基础操作 | 2 人日 |
| 2 | 实现 IndexedDB 持久化，页面加载/刷新恢复数据 | 1 人日 |
| 3 | 重构现有 UI 逻辑，替换 localStorage 调用为 SQL 操作 | 2 人日 |
| 4 | 实现导入导出功能（SQLite 文件 + JSON） | 1 人日 |
| 5 | 处理原有 localStorage 数据迁移提示 | 0.5 人日 |
| 6 | 测试、优化性能 | 1 人日 |

---

## 11. 验收标准

- [ ] 初始化后创建 SQLite 数据库，表结构正确。
- [ ] 增删改查操作正确，刷新页面数据不丢失。
- [ ] 删除成员时，子成员的 parent_id 置空。
- [ ] 导出 SQLite 文件，重新导入后数据完整。
- [ ] 导出 JSON 文件，重新导入后数据完整。
- [ ] 原有 localStorage 数据可迁移到 SQLite（提供按钮提示）。
- [ ] 树图展示和成员列表与之前完全一致。
- [ ] 支持至少 1 万成员，查询和展示无明显卡顿。

---

## 12. 后续扩展

- 第二期：接入云端同步，将 SQLite 作为本地缓存，与云端数据库双向同步。
- 支持全文搜索（通过 FTS5 虚拟表）。
- 支持媒体文件存储（使用 IndexedDB 或 OPFS 存储大文件，数据库存路径）。