# 开发实践

> **本文档记录 Prac 项目的开发实践细节——运行、测试、工具扩展等具体操作。**

## 运行系统

### CLI 入口

系统通过 `__main__.py` 启动，支持以下参数：

```bash
uv run python3 -m prac                    # 使用当前目录
uv run python3 -m prac /path/to/dir       # 指定工作目录
uv run python3 -m prac --memory-dir /path # 自定义记忆目录
```

### 内置命令

运行时可使用以下命令：

| 命令               | 功能             |
| ------------------ | ---------------- |
| `/quit` 或 `/exit` | 退出系统         |
| `/reset`           | 清除对话历史     |
| `/status`          | 查看任务队列状态 |
| `/stats`           | 查看记忆统计     |

## 依赖管理

使用 `uv` 管理依赖：

```bash
uv add <package>                      # 添加新依赖
uv sync --all-extras --all-groups     # 同步完整环境
uv run pytest                         # 运行测试
```

## 添加新工具

**步骤**：

1. 在 `src/prac/tools/` 创建新模块（如 `shell_ops.py`）
2. 定义 `ToolParams` 子类（参数模型）
3. 定义 `Tool` 子类（工具实现）
4. 创建 `PydanticToolProvider` 子类，列出所有工具类
5. 在 `src/prac/tools/__init__.py` 导出 Provider
6. 在 `src/prac/__main__.py` 的 `_create_agents()` 中注册

**示例**：

```python
# 1. tools/shell_ops.py
from .base import Tool, ToolParams, PydanticToolProvider

class RunCommandParams(ToolParams):
    command: str = Field(description="Shell command to run")

class RunCommandTool(Tool):
    name = "run_command"
    description = "Execute a shell command"
    params_model = RunCommandParams
    
    def execute(self, params: RunCommandParams) -> dict[str, Any]:
        # Implementation
        ...

class ShellTools(PydanticToolProvider):
    tool_classes = [RunCommandTool]

# 2. tools/__init__.py
from .shell_ops import ShellTools
__all__ = [..., "ShellTools"]

# 3. __main__.py
def _create_agents(...):
    ...
    shell_tools = ShellTools()
    executor.register_tools(shell_tools)
```

## 系统形态

**CLI 应用**：Prac 是 CLI 应用，不是库。

**包导出策略**：
- `__init__.py` 仅加载环境变量（`load_dotenv()`）
- 不导出公开 API
- 入口点为 `python -m prac`

**原因**：避免不必要的导出和依赖，保持简洁。

## 文档规范

**Markdown 格式**：
- notes/ 中不加无意义的装饰性水平分隔线
- 使用语义化的标题层级
- 代码块标注语言类型

**Docstring 风格**：
- 使用 Google 风格
- 所有公开函数必须有完整文档

## 测试规范

**组织**：
- 测试文件放在 `tests/` 目录
- 命名为 `test_<module>.py`
- 每个模块对应一个测试文件

**运行**：
```bash
uv run pytest                  # 运行全部测试
uv run pytest tests/test_xxx.py # 运行特定测试
uv run pytest -v               # 详细输出
```

**覆盖要求**：
- 新功能必须附带测试
- 关键路径必须有测试覆盖
- 边界情况应有测试

## 已知问题

（暂无）

## 未来计划

| 功能         | 说明                |
| ------------ | ------------------- |
| Shell Tools  | 执行 shell 命令     |
| Web Tools    | HTTP 请求、网页抓取 |
| Search Tools | 语义搜索、grep 搜索 |

## 相关文档

- [AGENTS.md](../AGENTS.md) - Agent 工作指南
- [agent_design_guide.md](agent_design_guide.md) - 设计模式与反模式
