# 文档索引

[返回项目首页](../README.md)

版本变更与尚未发布的修改见[更新日志](../changelog.md)。

文档按用途分类。当前开发从项目首页开始，部署和认证以 `guides/` 为准；
产品 PRD 与历史计划描述需求，不表示全部功能已交付或已通过发布验收。
文中未写相对目录的源码路径和命令默认以仓库根目录为基准。

## 使用指南

| 文档 | 内容 |
| --- | --- |
| [部署与发布](guides/deployment.md) | 当前 Workers + Static Assets + D1 部署、CI、版本与 tag、常见问题 |
| [登录与迁移](guides/login.md) | 普通用户、维护人员与系统管理员的认证和迁移边界 |

旧 `RELEASE.md`、D1 配置与快速修复、Drizzle 快速开始不再作为操作入口；
当前开发步骤集中在[项目首页](../README.md#本地开发)，发布与配置集中在部署指南。

## 产品需求

| 文档 | 定位 |
| --- | --- |
| [产品说明与 PRD](product/overview.md) | 合并原两份 README，保留完整浏览、移动端与产品需求说明 |
| [扫墓轨迹](product/navigation.md) | 基础轨迹需求与验收项 |
| [轨迹多媒体扩展](product/navigation-v2.md) | 标点照片/视频扩展需求，不代表已实现 |
| [OCR 导入](product/ocr.md) | 需求参考；当前维护界面暂缓开放 |
| [存储升级](product/storage-upgrade.md) | 历史 SQLite 主路径方案；当前只实现二进制快照备份，主存储仍为 D1 |

## 实施记录

| 文档 | 内容 |
| --- | --- |
| [Stage3 与 Vben 分阶段实施](implementation/stage3.md) | 角色、导航、可靠保存、只读浏览、导入解析与回归记录 |

记录中的日期、命令结果和完成度保留对应阶段口径，不视为当前线上验收结论。

## 历史归档

归档保留技术细节与过程证据，不再作为当前操作指南。特别是旧文档中的
静态 Pages、前端 Token、独立 API Worker 和 localStorage 回退说明不适用于当前版本。

| 文档 | 历史范围 |
| --- | --- |
| [早期部署手册](archive/legacy-deployment.md) | 单文件 Pages 与独立 D1 Worker 部署 |
| [Stage2 扩展需求](archive/stage2.md) | 早期扩展功能与优先级 |
| [Stage2 实施计划](archive/stage2-plan.md) | 旧基线、里程碑、任务和验收项 |
| [谱文校验报告 V2](archive/part-data-verification-v2.md) | 2026-04-30 的历史统计，本地源谱文不随仓库提供 |
| [Drizzle 迁移说明](archive/drizzle-d1/drizzle-migration.md) | 旧独立 Worker 的迁移设计 |
| [Drizzle 代码对比](archive/drizzle-d1/drizzle-comparison.md) | 迁移前后的代码示例 |
| [Drizzle 快速开始](archive/drizzle-d1/drizzle-quickstart.md) | 当时的开发与部署流程 |
| [D1 配置方案](archive/drizzle-d1/d1-setup.md) | 当时的连接配置 |
| [D1 快速修复](archive/drizzle-d1/d1-quick-fix.md) | 当时的排查参考卡 |
| [D1 调试指南](archive/drizzle-d1/d1-debugging.md) | 当时的连接与 CORS 排查 |
| [迁移完成报告](archive/drizzle-d1/completion-report.md) | 2026-04-04 的交付记录 |
| [迁移进度](archive/drizzle-d1/migration-progress.md) | 历史完成度与质量统计 |
| [迁移状态总结](archive/drizzle-d1/status-summary.md) | 当时的阶段总结 |

原根目录 `INDEX.md` 的重复导航已由本页替代；历史报告保留各自正文，避免丢失阶段证据。

## 文档维护约定

- 项目根目录保留 `README.md` 和 `changelog.md`，分别作为项目入口与版本变更记录；专题文档按用途放入 `docs/`。
- 专题文档使用小写连字符文件名与 `.md` 扩展名；每份文档在本索引登记。
- 一个主题只维护一份当前说明；旧方案与报告归档并标明适用边界。
- 移动文件时同步更新相对链接、正文路径与工具指引；不要把本地谱文提交为文档附件。
- `.github/` 的模板、`.claude/` 的工具说明与 `vendor/` 的上游 README 保持原有位置和用途。
