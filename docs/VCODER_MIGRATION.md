# spec_vcoder 迁移说明文档

本文档说明 smart-mode 插件中 vcoder/BitFunAI 相关代码的目录结构，以及其与 spec_vcoder 项目的对应关系。

---

## 一、smart-mode 当前目录结构

本插件**完全依赖 spec_vcoder 的编译产物**，不在 smart-mode 中构建 frontend/backend。

```
smart-mode/
├── build.gradle.kts
├── gradle/
├── src/
│   ├── main/
│   │   ├── java/
│   │   │   └── com/example/solo/
│   │   │       └── vcoder/                    ← 从 spec_vcoder 迁移的代码
│   │   │           ├── agent/
│   │   │           │   ├── AgentProcessManager.java
│   │   │           │   └── WebSocketClient.java
│   │   │           ├── integration/
│   │   │           │   └── ProjectContextProvider.java
│   │   │           ├── settings/
│   │   │           │   ├── DevEcoPathResolver.java
│   │   │           │   └── VcoderSettings.java
│   │   │           └── webview/
│   │   │               ├── CefQueryScriptBuilder.java
│   │   │               ├── JsBridgeHandler.java
│   │   │               ├── WebViewPanel.java
│   │   │               ├── WebviewResourceHandler.java
│   │   │               ├── WebviewResourceResolver.java
│   │   │               ├── WebviewResourceScheme.java
│   │   │               ├── WebviewResourceSchemeHandlerFactory.java
│   │   │               └── WorkspaceResponseBuilder.java
│   │   │
│   │   ├── kotlin/
│   │   │   └── com/example/solo/               ← 原 Solo 插件
│   │   │       ├── CustomPanel.kt
│   │   │       ├── SoloModeManager.kt
│   │   │       ├── SoloModePanel.kt
│   │   │       ├── SoloModeProjectListener.kt
│   │   │       ├── SoloModeState.kt
│   │   │       └── ToggleSoloModeAction.kt
│   │   │
│   │   └── resources/
│   │       ├── META-INF/
│   │       │   └── plugin.xml
│   │       ├── messages/
│   │       ├── META-INF/pluginIcon.svg
│   │       ├── webview/                        ← 从 spec_vcoder 复制
│   │       │   ├── index.html
│   │       │   ├── assets/
│   │       │   ├── fonts/
│   │       │   └── monaco-editor/
│   │       └── ts-backend/                     ← 从 spec_vcoder 复制（可选）
│   │           ├── dist/
│   │           ├── node_modules/
│   │           └── package.json
```

---

## 二、spec_vcoder 目录结构

```
spec_vcoder/
├── frontend/                                   ← 前端源码（Vite 构建）
├── backend/                                    ← TypeScript 后端
├── plugin/
│   ├── build.gradle.kts
│   └── src/
│       ├── main/
│       │   ├── java/
│       │   │   └── org/intellij/sdk/harmonyos/
│       │   │       ├── HarmonyOSToolWindowFactory.java   ← 未迁移（由 SoloModePanel 替代）
│       │   │       ├── agent/
│       │   │       │   ├── AgentProcessManager.java
│       │   │       │   └── WebSocketClient.java
│       │   │       ├── integration/
│       │   │       │   └── ProjectContextProvider.java
│       │   │       ├── mcp/
│       │   │       │   └── MCPResourceExtractor.java       ← 未迁移
│       │   │       ├── settings/
│       │   │       │   ├── DevEcoPathResolver.java
│       │   │       │   ├── HarmonyOSConfigurable.java    ← 未迁移（设置页）
│       │   │       │   └── HarmonyOSSettings.java
│       │   │       └── webview/
│       │   │           ├── CefQueryScriptBuilder.java
│       │   │           ├── JsBridgeHandler.java
│       │   │           ├── WebViewPanel.java
│       │   │           ├── WebviewResourceHandler.java
│       │   │           ├── WebviewResourceResolver.java
│       │   │           ├── WebviewResourceScheme.java
│       │   │           ├── WebviewResourceSchemeHandlerFactory.java
│       │   │           └── WorkspaceResponseBuilder.java
│       │   │
│       │   └── resources/
│       │       ├── META-INF/plugin.xml
│       │       ├── webview/                    ← 由 copyFrontend 构建产物
│       │       └── ts-backend/                ← 由 copyTypeScriptBackend 构建产物
```

---

## 三、文件对应关系表

| 功能 | spec_vcoder | smart-mode |
|------|-------------|------------|
| **包名** | `org.intellij.sdk.harmonyos` | `com.example.solo.vcoder` |
| Agent 进程管理 | `agent/AgentProcessManager.java` | `vcoder/agent/AgentProcessManager.java` |
| WebSocket 客户端 | `agent/WebSocketClient.java` | `vcoder/agent/WebSocketClient.java` |
| WebView 面板 | `webview/WebViewPanel.java` | `vcoder/webview/WebViewPanel.java` |
| JS 桥接 | `webview/JsBridgeHandler.java` | `vcoder/webview/JsBridgeHandler.java` |
| 资源 Scheme | `webview/WebviewResource*.java` | `vcoder/webview/WebviewResource*.java` |
| CefQuery 脚本 | `webview/CefQueryScriptBuilder.java` | `vcoder/webview/CefQueryScriptBuilder.java` |
| 工作区响应 | `webview/WorkspaceResponseBuilder.java` | `vcoder/webview/WorkspaceResponseBuilder.java` |
| 设置存储 | `settings/HarmonyOSSettings.java` | `vcoder/settings/VcoderSettings.java` |
| 路径解析 | `settings/DevEcoPathResolver.java` | `vcoder/settings/DevEcoPathResolver.java` |
| 项目上下文 | `integration/ProjectContextProvider.java` | `vcoder/integration/ProjectContextProvider.java` |
| 前端资源 | `resources/webview/` | `resources/webview/`（复制） |
| TS 后端 | `resources/ts-backend/` | `resources/ts-backend/`（复制） |

---

## 四、spec_vcoder 中未迁移的部分

| 文件/路径 | 说明 |
|-----------|------|
| `HarmonyOSToolWindowFactory.java` | 工具窗口工厂，由 `SoloModePanel` 直接嵌入 `WebViewPanel` 替代 |
| `HarmonyOSConfigurable.java` | 设置页（Tools → BitFunAI），未迁移 |
| `MCPResourceExtractor.java` | MCP 资源提取，未迁移 |
| `plugin.xml` 中的 toolWindow | 不再单独注册 BitFunAI 工具窗口 |

---

## 五、资源复制方式（完全依赖 spec_vcoder 编译产物）

smart-mode 不构建 frontend/backend，所有 webview 和 ts-backend 均从 spec_vcoder 的 `plugin/src/main/resources` 复制。

**构建步骤：**

1. **在 spec_vcoder 中先构建**：`cd spec_vcoder/plugin && gradlew copyFrontend copyTypeScriptBackend`
2. **在 smart-mode 中复制并构建**：`.\gradlew.bat copyVcoderResources` 或 `.\gradlew.bat build -x test`

若未先执行 spec_vcoder 的 copyFrontend/copyTypeScriptBackend，smart-mode 构建会失败并提示需先构建 spec_vcoder。

**specVcoderPath**：默认使用相对路径 `../spec_vcoder`（smart-mode 与 spec_vcoder 同级目录时有效），否则在 `gradle.properties` 中设置 `specVcoderPath=实际路径`。

---

## 六、构建步骤

1. **构建 spec_vcoder**：在 spec_vcoder 中执行 `copyFrontend` 和 `copyTypeScriptBackend`，生成 `webview` 和 `ts-backend` 资源。
2. **构建 smart-mode**：
   ```bash
   .\gradlew.bat copyVcoderResources   # 首次或更新 spec_vcoder 后执行
   .\gradlew.bat build -x test
   ```

3. **运行**：在 IDE 中通过 View → Enter Solo Mode（或 Ctrl+Shift+F12）进入 Solo 模式，左侧会显示 BitFunAI 页面。

## 七、后端自动启停

与 spec_vcoder 需手动运行 `npm run dev` 不同，smart-mode 已实现 **自动拉起和关闭** TypeScript 后端：

- **IDE 启动**：打开项目时自动在后台启动 TypeScript 后端（`BackendStartupActivity`），与项目类型无关。
- **进入 Solo 模式**：在后台线程调用 `getAgentAndWaitReady()`，阻塞直到后端端口就绪（最多 10 秒）后再创建前端 UI，避免快速进入时前端先于后端初始化。
- **退出 Solo 模式**：仅关闭 WebView，后端保持运行直至 IDE 退出。

**后端查找顺序**：
1. 用户配置 `backendPathOverride`（VcoderSettings，用于 OpenHarmony 等无法自动检测的场景）
2. 项目内 `{项目根}/backend`（如 spec_vcoder 项目）
3. 同级目录 `{项目父目录}/backend`
4. 同级 spec_vcoder 的 backend：`{项目父目录}/spec_vcoder/backend` 或 `spec_vcoder-spec_vcoder/backend`
5. 插件资源中的 `ts-backend`（构建时从 spec_vcoder 复制）

**配置路径**：使用 in-project backend 时，以 backend 目录为 workspace，读取 `backend/.vcoder_ts/config.json`，与手动 `cd backend && npm run dev` 行为一致，避免使用项目根 `.vcoder_ts` 中可能不同的 API key 或默认模型。

**环境变量**：若后端目录存在 `.env`，会自动加载（需 Node 20+）。

### 常见问题

**Q：后端一直无法启动（TypeScript Agent port 9600 not ready / exit code 9）**

- **原因**：后端进程启动后立即崩溃。常见原因：Node 未在 PATH（IDE 沙盒环境）、Windows 路径过长（node_modules 超过 260 字符）、或依赖缺失。
- **已做修复**：
  1. 进程崩溃后自动重试：进入 Solo 模式时会检测并重试
  2. Windows 下自动查找 Node：若 PATH 中无 node，会尝试 `Program Files\nodejs\node.exe` 等
  3. 缩短提取路径：Windows 下提取到 `%USERPROFILE%\.vcoder-ts\`，减少 MAX_PATH 风险
  4. 继承 CONSOLE 环境：子进程继承完整控制台环境变量（PATH 等）
  5. Node 预检：启动前运行 `node -e "console.log('ok')"`，失败则提示
  6. 使用相对路径：`dist/index.js` 替代绝对路径，避免路径问题
- **排查步骤**：
  1. **确认 spec_vcoder 已构建**：`cd spec_vcoder/plugin && gradlew copyFrontend copyTypeScriptBackend`
  2. **确认 smart-mode 已复制**：`gradlew copyVcoderResources`
  3. **确认 Node 已安装**：命令行执行 `node --version`，需 Node 18+
  4. **使用 spec_vcoder 的 backend**：将 smart-mode 与 spec_vcoder 置于同级目录（如 `Desktop/smart-mode` 与 `Desktop/spec_vcoder`），插件会优先使用 `spec_vcoder/backend`（需先 `cd spec_vcoder/backend && npm run build`）
  5. **手动配置路径**：若自动检测失败，设置 `backendPathOverride` 为 spec_vcoder/backend 的绝对路径。配置位置：IDE 配置目录下的 `options/solo-vcoder-settings.xml`，或通过 Settings 搜索 "Vcoder" 添加。若 exit 9 持续，可手动设置此项指向 `spec_vcoder\backend` 的完整路径（需先 `cd spec_vcoder/backend && npm run build`）
  6. **优先使用 spec_vcoder/backend**：将 smart-mode 与 spec_vcoder 置于同级（如 `Desktop\smart-mode` 与 `Desktop\spec_vcoder`），插件会优先使用 `spec_vcoder\backend`，避免从插件 JAR 提取（提取的 node_modules 可能有问题）

**Q：进入 Solo 模式时前端出现了但后端没启动（小概率）**

- **原因**：后端进程启动是异步的，前端加载后立即尝试连接 WebSocket，若后端尚未监听端口则连接失败。
- **解决**：已做两处改动：1）在 `SoloModeManager` 中先启动后端再创建 UI；2）在 `AgentProcessManager` 中启动进程后等待端口就绪（最多 15 秒）再返回。

**Q：打开 OpenHarmony 工程时没有后端**

- **原因**：OpenHarmony 工程通常没有内置 backend，自动检测可能找不到。
- **解决**：
  1. **先手动启动 backend**：`cd spec_vcoder/backend && npm run dev`，再打开 IDE 和工程，插件会复用已有进程。
  2. **同级目录**：将 OpenHarmony 工程与 spec_vcoder 放在同一父目录下（如 `Desktop/OpenHarmonyProject` 与 `Desktop/spec_vcoder`），插件会自动找到 `spec_vcoder/backend`。
  3. **手动配置**：在 `solo-vcoder-settings.xml`（IDE 配置目录）中设置 `backendPathOverride` 为 backend 的绝对路径。

**Q：出现「AI未初始化」报错，模型一直有问题**

- **原因**：后端端口已就绪，但 AI/模型配置尚未加载完成，前端过早发起请求导致。
- **解决**：JsBridge 层已增加重试：当响应包含「未初始化」时自动重试最多 3 次（每次间隔 2 秒）。若仍失败，可点击 **Reload** 按钮手动重新加载。

**Q：发起会话返回 402 Insufficient Balance**

- **原因**：项目根 `.vcoder_ts/config.json` 与 `backend/.vcoder_ts/config.json` 可能使用不同的 API key 或默认模型。插件若以项目根为 workspace，会读取前者，若该 key 余额不足则报 402。
- **解决**：使用 in-project backend 时，插件会自动以 backend 目录为 workspace，读取 `backend/.vcoder_ts/config.json`，与手动 `cd backend && npm run dev` 行为一致。确保 `backend/.vcoder_ts/config.json` 中配置了可用的 API key 或本地模型。
