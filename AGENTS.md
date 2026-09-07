# AGENTS.md

## Cursor Cloud specific instructions

### Project Overview

LocalMiniDrama (本地短剧助手) — an AI-powered local short drama creation tool. Single product, three sub-projects sharing one repo (no monorepo tooling).

### Services

| Service | Directory | Port | Start Command |
|---------|-----------|------|---------------|
| Backend (Express + SQLite) | `backend-node/` | 5679 | `npm run dev` |
| Frontend (Vite + Vue 3) | `frontweb/` | 3013 | `npm run dev` |

Frontend proxies `/api` and `/static` to backend via Vite config.

### Running Tests

```bash
# Backend tests (Node.js built-in test runner)
cd backend-node && node --test test/*.test.js

# Frontend tests (ESM, Node.js built-in test runner)
cd frontweb && node --test test/*.test.js
```

No ESLint or other lint tool is configured in this codebase.

### Building

```bash
cd frontweb && npm run build
```

### Key Development Notes

- Pure JavaScript (no TypeScript) throughout.
- Backend uses `node --watch` for hot reloading in dev mode (`npm run dev`).
- Database is SQLite (embedded via `better-sqlite3`), auto-created in `backend-node/data/`.
- Migrations run automatically on backend startup (`ensureColumns()`); explicit `npm run migrate` only needed for first-time setup or after adding new migration SQL files.
- Config file at `backend-node/configs/config.yaml` already exists in the repo — no need to copy from example.
- AI content generation requires external API keys (configured via the app's "AI 配置" page), but the app fully functions without them for development/testing purposes.
- The backend also serves the built frontend from `frontweb/dist/` at port 5679 when the dist folder exists; during development, use the Vite dev server at port 3013 instead.

### 版本迭代记录规则

- 根目录 `CHANGELOG.md` 是本项目唯一的版本迭代记录，必须持续维护，不得在其他文档中建立并行的版本记录。
- 每次完成新功能、现有模块优化或问题修复，并完成相应验证后，必须在同一批变更中同步更新 `CHANGELOG.md`；未更新版本记录的功能性变更不视为完成。
- 尚未发布的变更统一记录在 `[未发布]` 章节，并按“新增”“优化”“修复”“文档与工程”分类；没有内容的分类可以省略。
- 条目应说明用户可感知的结果和受影响的模块，避免只记录文件名、提交编号或模糊描述；涉及配置、数据迁移、兼容性或破坏性变更时必须明确标注。
- 仅记录已经实现并验证的内容，不把计划、设想、调研结论或尚未完成的工作写入版本记录。
- 发布新版本时，将本次发布的条目从 `[未发布]` 移至 `## [版本号] - YYYY-MM-DD` 章节；保留未随本次发布的条目，并确保新增功能、优化和问题修复均已完整归档。
