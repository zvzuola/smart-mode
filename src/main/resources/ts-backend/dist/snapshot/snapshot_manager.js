/**
 * 快照管理器 - 核心管理逻辑
 *
 * 对标Rust版本：
 * backend/vcoder/crates/core/src/service/snapshot/manager.rs
 * backend/vcoder/crates/core/src/service/snapshot/service.rs
 */
import { promises as fs } from "node:fs";
import { FileSnapshotStorage } from "./file_snapshot.js";
import { OperationTracker } from "./operation_tracker.js";
import { OperationType as OpType } from "./types.js";
/**
 * 快照管理器
 *
 * 统一管理文件快照和操作追踪
 */
export class SnapshotManager {
    snapshotStorage;
    operationTracker;
    workspaceDir;
    initialized = false;
    constructor(workspaceDir) {
        this.workspaceDir = workspaceDir;
        this.snapshotStorage = new FileSnapshotStorage(workspaceDir);
        this.operationTracker = new OperationTracker(workspaceDir);
    }
    /**
     * 初始化
     */
    async initialize() {
        await this.snapshotStorage.initialize();
        await this.operationTracker.initialize();
        this.initialized = true;
        console.info("✅ [SnapshotManager] 初始化完成");
    }
    /**
     * 确保已初始化
     */
    ensureInitialized() {
        if (!this.initialized) {
            throw new Error("SnapshotManager not initialized");
        }
    }
    /**
     * 记录文件修改
     *
     * @param sessionId 会话ID
     * @param turnIndex Turn索引
     * @param seqInTurn 同一turn内的序号
     * @param filePath 文件路径
     * @param operationType 操作类型
     * @param toolName 工具名称
     * @returns 操作ID和快照ID
     */
    async recordFileChange(sessionId, turnIndex, seqInTurn, filePath, operationType, toolName) {
        this.ensureInitialized();
        let beforeSnapshotId;
        // 1. 如果是修改或删除操作，创建操作前快照
        if (operationType === OpType.Modify || operationType === OpType.Delete) {
            try {
                // 检查文件是否存在
                await fs.access(filePath);
                const snapshot = await this.snapshotStorage.createSnapshot(filePath);
                beforeSnapshotId = snapshot.snapshotId;
                console.info(`📸 [SnapshotManager] 创建操作前快照: ${beforeSnapshotId} for ${filePath}`);
            }
            catch (error) {
                console.warn(`⚠️ [SnapshotManager] 创建快照失败（文件可能不存在）: ${filePath}`, error);
            }
        }
        // 2. 记录操作
        const operationId = `op-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const operation = {
            operationId,
            sessionId,
            turnIndex,
            seqInTurn,
            operationType,
            toolName,
            filePath,
            beforeSnapshotId,
            timestamp: Date.now(),
        };
        await this.operationTracker.recordOperation(operation);
        return { operationId, snapshotId: beforeSnapshotId };
    }
    /**
     * 回滚Session的所有文件修改
     *
     * @param sessionId 会话ID
     * @returns 回滚结果
     */
    async rollbackSession(sessionId) {
        this.ensureInitialized();
        console.info(`⏪ [SnapshotManager] 开始回滚session: ${sessionId}`);
        // 1. 获取所有操作
        const operations = await this.operationTracker.getSessionOperations(sessionId);
        console.info(`   找到 ${operations.length} 个操作`);
        // 2. 倒序执行回滚
        return await this.rollbackOperations(operations.reverse());
    }
    /**
     * 回滚到指定Turn
     *
     * @param sessionId 会话ID
     * @param targetTurn 目标Turn索引（回滚该turn及之后的操作）
     * @returns 回滚结果
     */
    async rollbackToTurn(sessionId, targetTurn) {
        this.ensureInitialized();
        console.info(`⏪ [SnapshotManager] 回滚到turn ${targetTurn}: session=${sessionId}`);
        // 1. 获取需要回滚的操作
        const operations = await this.operationTracker.getOperationsFrom(sessionId, targetTurn);
        console.info(`   找到 ${operations.length} 个操作需要回滚`);
        // 2. 倒序执行回滚
        const result = await this.rollbackOperations(operations.reverse());
        // 3. 删除操作记录
        await this.operationTracker.deleteOperationsFrom(sessionId, targetTurn);
        return result;
    }
    /**
     * 执行操作回滚
     */
    async rollbackOperations(operations) {
        const restoredFiles = [];
        const failedOperations = [];
        for (const operation of operations) {
            try {
                await this.rollbackSingleOperation(operation);
                restoredFiles.push(operation.filePath);
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                failedOperations.push({
                    operationId: operation.operationId,
                    filePath: operation.filePath,
                    error: errorMessage,
                });
                console.error(`❌ [SnapshotManager] 回滚操作失败: ${operation.operationId}`, error);
            }
        }
        const result = {
            restoredFiles: Array.from(new Set(restoredFiles)),
            failedOperations,
            totalOperations: operations.length,
            successCount: restoredFiles.length,
            failureCount: failedOperations.length,
        };
        console.info(`✅ [SnapshotManager] 回滚完成: ${result.successCount} 成功, ${result.failureCount} 失败`);
        return result;
    }
    /**
     * 回滚单个操作
     */
    async rollbackSingleOperation(operation) {
        switch (operation.operationType) {
            case OpType.Create:
                // 删除创建的文件
                await this.deleteFileIfExists(operation.filePath);
                console.info(`🗑️ [SnapshotManager] 删除创建的文件: ${operation.filePath}`);
                break;
            case OpType.Modify:
            case OpType.Delete:
                // 从快照恢复文件
                if (operation.beforeSnapshotId) {
                    await this.snapshotStorage.restoreFile(operation.beforeSnapshotId, operation.filePath);
                    console.info(`📦 [SnapshotManager] 恢复文件: ${operation.filePath} from ${operation.beforeSnapshotId}`);
                }
                else {
                    console.warn(`⚠️ [SnapshotManager] 无法恢复文件（缺少快照）: ${operation.filePath}`);
                }
                break;
            case OpType.Rename:
                // 重命名操作的回滚（如果支持）
                console.warn(`⚠️ [SnapshotManager] 暂不支持回滚重命名操作: ${operation.filePath}`);
                break;
            default:
                console.warn(`⚠️ [SnapshotManager] 未知操作类型: ${operation.operationType}`);
        }
    }
    /**
     * 删除文件（如果存在）
     */
    async deleteFileIfExists(filePath) {
        try {
            await fs.unlink(filePath);
        }
        catch (error) {
            // 文件可能已经不存在，忽略错误
            console.debug(`文件不存在或已删除: ${filePath}`);
        }
    }
    /**
     * 接受Session的所有修改（清理快照）
     */
    async acceptSession(sessionId) {
        this.ensureInitialized();
        console.info(`✅ [SnapshotManager] 接受session修改: ${sessionId}`);
        // 1. 获取所有操作
        const operations = await this.operationTracker.getSessionOperations(sessionId);
        // 2. 删除所有快照
        for (const operation of operations) {
            if (operation.beforeSnapshotId) {
                await this.snapshotStorage.deleteSnapshot(operation.beforeSnapshotId);
            }
        }
        // 3. 删除操作记录
        await this.operationTracker.deleteSessionOperations(sessionId);
        console.info(`✅ [SnapshotManager] Session已接受，快照已清理: ${sessionId}`);
    }
    /**
     * 获取Session影响的文件列表
     */
    async getSessionFiles(sessionId) {
        this.ensureInitialized();
        return await this.operationTracker.getSessionFiles(sessionId);
    }
    /**
     * 获取Turn影响的文件列表
     */
    async getTurnFiles(sessionId, turnIndex) {
        this.ensureInitialized();
        return await this.operationTracker.getTurnFiles(sessionId, turnIndex);
    }
    /**
     * 获取文件的变更历史
     */
    async getFileChangeHistory(sessionId, filePath) {
        this.ensureInitialized();
        const operations = await this.operationTracker.getFileHistory(sessionId, filePath);
        return operations.map((op) => ({
            operationId: op.operationId,
            sessionId: op.sessionId,
            turnIndex: op.turnIndex,
            operationType: op.operationType,
            toolName: op.toolName,
            timestamp: op.timestamp,
            snapshotId: op.beforeSnapshotId,
        }));
    }
    /**
     * 获取Session信息
     */
    async getSessionInfo(sessionId) {
        this.ensureInitialized();
        return await this.operationTracker.getSessionInfo(sessionId);
    }
    /**
     * 获取Turn信息
     */
    async getTurnInfo(sessionId, turnIndex) {
        this.ensureInitialized();
        return await this.operationTracker.getTurnInfo(sessionId, turnIndex);
    }
    /**
     * 获取统计信息
     */
    async getStats() {
        this.ensureInitialized();
        const storageStats = await this.snapshotStorage.getStorageStats();
        const sessions = await this.operationTracker.listSessions();
        // 计算总操作数
        let totalOperations = 0;
        for (const sessionId of sessions) {
            const operations = await this.operationTracker.getSessionOperations(sessionId);
            totalOperations += operations.length;
        }
        return {
            totalSnapshots: storageStats.totalSnapshots,
            totalOperations,
            totalStorageBytes: storageStats.totalStorageBytes,
            activeSessions: sessions.length,
        };
    }
    /**
     * 清理过期数据
     *
     * @param keepRecentDays 保留最近N天的数据
     */
    async cleanupOldData(keepRecentDays) {
        this.ensureInitialized();
        const beforeTimestamp = Date.now() - keepRecentDays * 24 * 60 * 60 * 1000;
        console.info(`🧹 [SnapshotManager] 清理 ${keepRecentDays} 天前的数据`);
        const snapshotsCleanedCount = await this.snapshotStorage.cleanupOldSnapshots(beforeTimestamp);
        const sessionsCleanedCount = await this.operationTracker.cleanupOldSessions(beforeTimestamp);
        return {
            snapshots: snapshotsCleanedCount,
            sessions: sessionsCleanedCount,
        };
    }
    /**
     * 列出所有session
     */
    async listSessions() {
        this.ensureInitialized();
        return await this.operationTracker.listSessions();
    }
    /**
     * 删除Session的所有数据
     */
    async deleteSession(sessionId) {
        this.ensureInitialized();
        console.info(`🗑️ [SnapshotManager] 删除session数据: ${sessionId}`);
        // 1. 获取所有操作
        const operations = await this.operationTracker.getSessionOperations(sessionId);
        // 2. 删除所有快照
        for (const operation of operations) {
            if (operation.beforeSnapshotId) {
                await this.snapshotStorage.deleteSnapshot(operation.beforeSnapshotId);
            }
        }
        // 3. 删除操作记录
        await this.operationTracker.deleteSessionOperations(sessionId);
        console.info(`✅ [SnapshotManager] Session数据已删除: ${sessionId}`);
    }
    /**
     * 获取工作区路径
     */
    getWorkspaceDir() {
        return this.workspaceDir;
    }
}
//# sourceMappingURL=snapshot_manager.js.map