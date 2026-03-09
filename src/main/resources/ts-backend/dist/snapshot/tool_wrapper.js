/**
 * 工具包装器 - 自动拦截文件操作
 *
 * 对标Rust版本：
 * backend/vcoder/crates/core/src/service/snapshot/manager.rs::WrappedTool
 */
import path from "node:path";
import { OperationType } from "./types.js";
/**
 * 包装的工具
 *
 * 为文件操作工具自动添加快照功能
 */
export class WrappedTool {
    name;
    description;
    originalTool;
    snapshotManager;
    constructor(originalTool, snapshotManager) {
        this.name = originalTool.name;
        this.description = originalTool.description;
        this.originalTool = originalTool;
        this.snapshotManager = snapshotManager;
    }
    get_definition() {
        return this.originalTool.get_definition();
    }
    is_end_turn_tool() {
        return this.originalTool.is_end_turn_tool();
    }
    needs_permissions() {
        // 快照包装的工具不需要用户确认
        // 因为所有修改都会被记录，用户可以随时回滚
        return false;
    }
    is_concurrency_safe() {
        return this.originalTool.is_concurrency_safe();
    }
    is_readonly() {
        return this.originalTool.is_readonly();
    }
    /**
     * 执行工具（带快照）
     */
    async execute(input, context) {
        // 检查是否为文件操作工具
        if (this.isFileModificationTool()) {
            try {
                return await this.executeWithSnapshot(input, context);
            }
            catch (error) {
                console.warn(`⚠️ [WrappedTool] 快照处理失败，回退到原始工具: ${this.name}`, error);
                // 回退到原始工具
            }
        }
        // 执行原始工具
        return await this.originalTool.execute(input, context);
    }
    /**
     * 执行工具并创建快照
     */
    async executeWithSnapshot(input, context) {
        const sessionId = context.session_id;
        const turnIndex = context.turn_index || 0;
        if (!sessionId) {
            throw new Error("session_id is required for snapshot tracking");
        }
        // 1. 提取文件路径
        const filePath = this.extractFilePath(input, context);
        if (!filePath) {
            throw new Error("Cannot extract file path from input");
        }
        // 2. 解析文件路径
        const resolvedPath = this.resolveFilePath(filePath, context);
        // 3. 确定操作类型
        const operationType = this.determineOperationType();
        // 4. 获取当前turn的操作序号
        const seqInTurn = await this.getNextSeqInTurn(sessionId, turnIndex);
        // 5. 创建快照（在执行前）
        console.info(`📸 [WrappedTool] 准备创建快照: ${this.name} ${resolvedPath}`);
        const { operationId, snapshotId } = await this.snapshotManager.recordFileChange(sessionId, turnIndex, seqInTurn, resolvedPath, operationType, this.name);
        console.info(`✅ [WrappedTool] 快照已创建: operation=${operationId}, snapshot=${snapshotId || "N/A"}`);
        // 6. 执行原始工具
        const result = await this.originalTool.execute(input, context);
        // 7. 在结果中添加快照信息
        if (typeof result === "object" && result !== null) {
            result._snapshotInfo = {
                operationId,
                snapshotId,
                tracked: true,
            };
        }
        return result;
    }
    /**
     * 检查是否为文件修改工具
     */
    isFileModificationTool() {
        const fileModificationTools = [
            "Write",
            "Edit",
            "Delete",
            "StrReplace",
            "write_file",
            "edit_file",
            "create_file",
            "delete_file",
            "rename_file",
            "move_file",
        ];
        return fileModificationTools.includes(this.name);
    }
    /**
     * 提取文件路径
     */
    extractFilePath(input, context) {
        const args = input.arguments || {};
        // 尝试各种可能的字段名
        const pathFields = ["path", "file_path", "filePath", "target_path", "source_path"];
        for (const field of pathFields) {
            if (args[field] && typeof args[field] === "string") {
                return args[field];
            }
        }
        return null;
    }
    /**
     * 解析文件路径
     */
    resolveFilePath(filePath, context) {
        // 如果是绝对路径，直接返回
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        // 相对路径：相对于workspace
        const workspace = context.workspace_path || this.snapshotManager.getWorkspaceDir();
        return path.join(workspace, filePath);
    }
    /**
     * 确定操作类型
     */
    determineOperationType() {
        switch (this.name) {
            case "Delete":
            case "delete_file":
                return OperationType.Delete;
            case "Write":
            case "write_file":
            case "create_file":
                return OperationType.Create; // 简化处理，实际应该检查文件是否存在
            case "Edit":
            case "StrReplace":
            case "edit_file":
            case "search_replace":
                return OperationType.Modify;
            case "rename_file":
            case "move_file":
                return OperationType.Rename;
            default:
                return OperationType.Modify;
        }
    }
    /**
     * 获取下一个序号
     */
    seqCounter = new Map();
    async getNextSeqInTurn(sessionId, turnIndex) {
        const key = `${sessionId}-${turnIndex}`;
        const current = this.seqCounter.get(key) || 0;
        const next = current + 1;
        this.seqCounter.set(key, next);
        return next;
    }
}
/**
 * 创建包装的工具注册表
 *
 * @param originalTools 原始工具列表
 * @param snapshotManager 快照管理器
 * @returns 包装后的工具列表
 */
export function wrapToolsWithSnapshot(originalTools, snapshotManager) {
    return originalTools.map((tool) => {
        // 文件操作工具使用包装器
        const fileModificationTools = [
            "Write",
            "Edit",
            "Delete",
            "StrReplace",
            "write_file",
            "edit_file",
            "delete_file",
        ];
        if (fileModificationTools.includes(tool.name)) {
            console.info(`🔒 [ToolWrapper] 包装工具: ${tool.name}`);
            return new WrappedTool(tool, snapshotManager);
        }
        // 其他工具直接返回
        return tool;
    });
}
//# sourceMappingURL=tool_wrapper.js.map