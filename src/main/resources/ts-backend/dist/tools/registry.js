/**
 * 工具注册表
 * 管理所有可用的工具
 */
import { ReadTool } from "./implementations/read_tool.js";
import { WriteTool } from "./implementations/write_tool.js";
import { ShellTool } from "./implementations/shell_tool.js";
import { StrReplaceTool } from "./implementations/str_replace_tool.js";
import { DeleteTool } from "./implementations/delete_tool.js";
import { LSTool } from "./implementations/ls_tool.js";
import { GlobTool } from "./implementations/glob_tool.js";
import { GrepTool } from "./implementations/grep_tool.js";
import { TodoWriteTool } from "./implementations/todo_write_tool.js";
import { GitTool } from "./implementations/git_tool.js";
import { HmosCompilationTool } from "./implementations/hmos_compilation_tool.js";
import { wrapToolsWithSnapshot } from "../snapshot/index.js";
/**
 * 全局工具注册表
 */
class ToolRegistry {
    tools = new Map();
    snapshotManager;
    snapshotEnabled = false;
    /**
     * 设置快照管理器（启用快照功能）
     */
    setSnapshotManager(snapshotManager) {
        this.snapshotManager = snapshotManager;
        this.snapshotEnabled = true;
        console.info("✅ [ToolRegistry] 快照管理器已设置，工具将自动启用快照功能");
    }
    /**
     * 注册工具
     */
    register(tool) {
        if (this.tools.has(tool.name)) {
            console.warn(`Tool "${tool.name}" is already registered, overwriting`);
        }
        this.tools.set(tool.name, tool);
    }
    /**
     * 获取工具
     */
    get(name) {
        return this.tools.get(name);
    }
    /**
     * 检查工具是否已注册
     */
    has(name) {
        return this.tools.has(name);
    }
    /**
     * 获取所有工具名称
     */
    get_all_tool_names() {
        return Array.from(this.tools.keys());
    }
    /**
     * 获取所有工具定义
     */
    get_all_tool_definitions() {
        return Array.from(this.tools.values()).map((tool) => tool.get_definition());
    }
    /**
     * 获取终止轮次的工具名称列表
     */
    get_end_turn_tool_names() {
        return Array.from(this.tools.values())
            .filter((tool) => tool.is_end_turn_tool())
            .map((tool) => tool.name);
    }
    /**
     * 获取所有已注册的工具
     */
    get_all_tools() {
        const tools = Array.from(this.tools.values());
        // 如果启用了快照，包装工具
        if (this.snapshotEnabled && this.snapshotManager) {
            return wrapToolsWithSnapshot(tools, this.snapshotManager);
        }
        return tools;
    }
    /**
     * 清空所有工具（仅用于测试）
     */
    clear() {
        this.tools.clear();
    }
}
/**
 * 全局工具注册表实例
 */
const globalRegistry = new ToolRegistry();
/**
 * 初始化内置工具
 */
function initializeBuiltinTools() {
    // 注册内置工具
    globalRegistry.register(new ReadTool());
    globalRegistry.register(new WriteTool());
    globalRegistry.register(new ShellTool());
    globalRegistry.register(new StrReplaceTool()); // Edit
    globalRegistry.register(new DeleteTool());
    globalRegistry.register(new LSTool());
    globalRegistry.register(new GlobTool());
    globalRegistry.register(new GrepTool());
    globalRegistry.register(new TodoWriteTool());
    globalRegistry.register(new GitTool());
    globalRegistry.register(new HmosCompilationTool());
}
// 自动初始化
initializeBuiltinTools();
/**
 * 获取全局工具注册表
 */
export function getGlobalToolRegistry() {
    return globalRegistry;
}
/**
 * 获取所有工具定义
 */
export function getAllToolDefinitions() {
    return globalRegistry.get_all_tool_definitions();
}
/**
 * 获取终止轮次的工具名称列表
 */
export function getEndTurnToolNames() {
    return globalRegistry.get_end_turn_tool_names();
}
//# sourceMappingURL=registry.js.map