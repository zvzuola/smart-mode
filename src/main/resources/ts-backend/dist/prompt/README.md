# System Prompt模块

对标Rust版本的PromptBuilder系统，用于构建AI Agent的系统提示词。

## 📁 目录结构

```
src/prompt/
├── prompt_builder.ts    # PromptBuilder核心类
├── index.ts            # 导出和辅助函数
├── templates/          # System Prompt模板
│   └── agentic_mode.md # 默认Agent模式模板
└── README.md          # 本文档
```

## 🚀 快速开始

### ✅ 已集成到对话系统

System Prompt已在`src/actions.ts`中自动使用，每次对话都会包含完整的系统提示词。

### 基本使用

```typescript
import { buildSystemPrompt } from "./prompt/index.js";

// 构建系统提示词
const systemPrompt = await buildSystemPrompt(workspacePath);

// 在AI对话中使用
const messages = [
  { role: "system", content: systemPrompt },
  { role: "user", content: userInput },
];
```

### 高级使用

```typescript
import { PromptBuilder } from "./prompt/index.js";

const builder = new PromptBuilder(workspacePath);

// 获取各个组件
const envInfo = builder.getEnvInfo();
const projectLayout = await builder.getProjectLayout();
const langPref = await builder.getLanguagePreference();

// 使用模板
const template = await getEmbeddedPrompt("agentic_mode");
const prompt = await builder.buildPromptFromTemplate(template);
```

## 📝 占位符系统

System Prompt模板支持以下占位符：

| 占位符 | 说明 | 状态 |
|--------|------|------|
| `{LANGUAGE_PREFERENCE}` | 用户语言偏好（支持40+种语言） | ✅ 已实现 |
| `{ENV_INFO}` | 环境信息（OS、架构、日期） | ✅ 已实现 |
| `{PROJECT_LAYOUT}` | 项目文件结构（最多200条目） | ✅ 已实现 |
| `{RULES}` | AI规则（从`.cursor/rules/`加载） | ⚠️ 待实现 |
| `{MEMORIES}` | AI记忆点 | ⚠️ 待实现 |

## 🎯 示例：集成到对话系统

在`actions.ts`中使用：

```typescript
import { buildSystemPrompt } from "./prompt/index.js";

async function runDialogTurn(
  ctx: AppContext,
  session: Session,
  userInput: string
): Promise<void> {
  // 构建系统提示词
  const systemPrompt = await buildSystemPrompt(
    session.workspacePath || process.cwd()
  );

  // 构建消息历史
  const messages = [
    { role: "system", content: systemPrompt },
    ...session.messages,
    { role: "user", content: userInput },
  ];

  // 执行对话
  const result = await aiService.chat(messages);
  // ...
}
```

## 📋 PromptBuilder API

### 构造函数

```typescript
constructor(workspacePath: string)
```

创建一个PromptBuilder实例。

**参数**:
- `workspacePath`: 工作区路径

### 方法

#### `getEnvInfo(): string`

获取环境信息（操作系统、架构、当前日期）。

**返回**: 格式化的环境信息Markdown文本

#### `async getProjectLayout(): Promise<string>`

获取项目文件结构（递归，最多200个条目）。

**返回**: 格式化的文件列表Markdown文本

#### `async getLanguagePreference(): Promise<string>`

获取用户语言偏好指令。

**返回**: 语言偏好指令Markdown文本

#### `async loadAIRules(): Promise<string | undefined>`

加载AI规则。

**返回**: AI规则文本，如果没有则返回undefined

**状态**: ⚠️ 待实现（当前返回undefined）

#### `async loadAIMemories(): Promise<string | undefined>`

加载AI记忆点。

**返回**: AI记忆点文本，如果没有则返回undefined

**状态**: ⚠️ 待实现（当前返回undefined）

#### `async buildPromptFromTemplate(template: string): Promise<string>`

从模板构建完整的系统提示词。

**参数**:
- `template`: 包含占位符的模板文本

**返回**: 填充占位符后的完整prompt文本

## 🌍 支持的语言

PromptBuilder支持40+种语言的语言偏好设置：

- **中文**: 简体中文、繁体中文
- **英语**: 美式、英式、加拿大、澳大利亚等
- **日语、韩语**
- **欧洲语言**: 西班牙语、法语、德语、意大利语、葡萄牙语、俄语等
- **亚洲语言**: 泰语、越南语、印尼语、马来语、印地语等
- **其他**: 阿拉伯语、希伯来语、土耳其语等

## 🔗 相关文档

- [SYSTEM_PROMPT_ALIGNMENT.md](../../SYSTEM_PROMPT_ALIGNMENT.md) - 详细的对齐说明
- [ALIGNMENT_COMPLETE.md](../../ALIGNMENT_COMPLETE.md) - 整体对齐报告

## 📄 对标

**Rust版本**: `backend/vcoder/crates/core/src/agentic/agents/prompt_builder/`

**对齐度**: 90% （核心功能100%对齐）
