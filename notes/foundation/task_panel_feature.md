---
date: 2026-01-28
tags: [feature, tui, task-management]
---

# 任务面板功能

## 概述

为 TUI 添加了实时任务列表展示面板，用于显示进行中的任务。

## 功能特性

### 1. 任务面板组件 (`task_panel.py`)

- **位置**：`src/prac/tui/task_panel.py`
- **功能**：
  - 显示活跃任务（pending 和 running 状态）
  - 实时更新任务状态
  - 显示任务元数据（ID、标题、状态、优先级、时间）
  - 状态图标：⏸️ pending, ▶️ running, ✅ success, ❌ failed, 🚫 blocked
  - 优先级标识：[!] urgent, [↑] high, [-] normal, [↓] low

### 2. 布局集成

- **水平分割布局**：
  - 左侧：聊天区域（输出 + 输入）
  - 右侧：任务面板（40字符宽）
  - 分隔符：`│` 字符

### 3. 交互功能

- **F2 快捷键**：切换任务面板显示/隐藏
- **自动刷新**：每秒更新一次任务列表
- **可滚动**：支持鼠标滚动和键盘导航

## 实现细节

### 架构调整

1. **AsyncChatLoop**：
   - 新增 `task_queue: TaskQueue` 参数（全局任务队列）
   - 区分 `_async_queue`（异步执行队列）和 `task_queue`（全局任务队列）
   - 添加 `_update_task_panel()` 后台任务定期刷新面板

2. **动态布局**：
   - `_create_layout_container()`：根据 `_show_task_panel` 创建布局
   - `_rebuild_layout()`：重建布局并刷新界面

3. **主入口更新**：
   - `__main__.py` 的 `_create_agents()` 现在返回 `TaskQueue` 实例
   - 传递给 `AsyncChatLoop` 用于任务状态查询

### 时间格式化

- 相对时间显示：
  - < 60s: "Xs ago"
  - < 1h: "Xm ago"
  - < 24h: "Xh ago"
  - >= 24h: "MM-DD HH:MM"

## 使用示例

```bash
# 启动应用
uv run python3 -m prac

# 界面操作
F2          # 切换任务面板
Tab         # 切换焦点（聊天历史 <-> 输入框）
/status     # 查看任务统计
/quit       # 退出
```

## 未来改进

- [ ] 点击任务显示详情
- [ ] 支持取消任务
- [ ] 任务完成通知
- [ ] 可配置面板宽度
- [ ] 支持多种过滤/排序方式
- [ ] 任务执行进度条
