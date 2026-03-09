/**
 * 操作追踪器
 *
 * 对标Rust版本：
 * backend/vcoder/crates/core/src/service/snapshot/snapshot_core.rs
 */
import { promises as fs } from "node:fs";
import path from "node:path";
/**
 * 操作追踪器
 *
 * 负责记录和管理所有文件操作
 */
export class OperationTracker {
    workspaceDir;
    operationsDir;
    sessionsDir;
    constructor(workspaceDir) {
        this.workspaceDir = workspaceDir;
        this.operationsDir = path.join(workspaceDir, ".vcoder_ts", "operations");
        this.sessionsDir = path.join(workspaceDir, ".vcoder_ts", "sessions_snapshot");
    }
    /**
     * 初始化
     */
    async initialize() {
        await fs.mkdir(this.operationsDir, { recursive: true });
        await fs.mkdir(this.sessionsDir, { recursive: true });
        console.info("✅ [OperationTracker] 初始化完成");
    }
    /**
     * 记录操作
     */
    async recordOperation(operation) {
        // 1. 保存到session目录
        const sessionDir = path.join(this.sessionsDir, operation.sessionId);
        await fs.mkdir(sessionDir, { recursive: true });
        const operationFile = path.join(sessionDir, `${operation.operationId}.json`);
        await fs.writeFile(operationFile, JSON.stringify(operation, null, 2), "utf-8");
        // 2. 更新session信息
        await this.updateSessionInfo(operation.sessionId);
        console.info(`✅ [OperationTracker] 记录操作: ${operation.operationType} ${operation.filePath} (session: ${operation.sessionId}, turn: ${operation.turnIndex})`);
    }
    /**
     * 获取session的所有操作
     */
    async getSessionOperations(sessionId) {
        const sessionDir = path.join(this.sessionsDir, sessionId);
        try {
            const files = await fs.readdir(sessionDir);
            const operations = [];
            for (const file of files) {
                if (file.endsWith(".json") && !file.startsWith("info-")) {
                    const filePath = path.join(sessionDir, file);
                    const content = await fs.readFile(filePath, "utf-8");
                    operations.push(JSON.parse(content));
                }
            }
            // 按时间戳排序
            operations.sort((a, b) => {
                if (a.turnIndex !== b.turnIndex) {
                    return a.turnIndex - b.turnIndex;
                }
                return a.seqInTurn - b.seqInTurn;
            });
            return operations;
        }
        catch (error) {
            // Session目录不存在
            return [];
        }
    }
    /**
     * 获取指定turn的操作
     */
    async getTurnOperations(sessionId, turnIndex) {
        const allOperations = await this.getSessionOperations(sessionId);
        return allOperations.filter((op) => op.turnIndex === turnIndex);
    }
    /**
     * 获取从指定turn开始的所有操作
     */
    async getOperationsFrom(sessionId, fromTurnIndex) {
        const allOperations = await this.getSessionOperations(sessionId);
        return allOperations.filter((op) => op.turnIndex >= fromTurnIndex);
    }
    /**
     * 获取session影响的文件列表
     */
    async getSessionFiles(sessionId) {
        const operations = await this.getSessionOperations(sessionId);
        const files = new Set(operations.map((op) => op.filePath));
        return Array.from(files);
    }
    /**
     * 获取turn影响的文件列表
     */
    async getTurnFiles(sessionId, turnIndex) {
        const operations = await this.getTurnOperations(sessionId, turnIndex);
        const files = new Set(operations.map((op) => op.filePath));
        return Array.from(files);
    }
    /**
     * 获取文件的操作历史
     */
    async getFileHistory(sessionId, filePath) {
        const operations = await this.getSessionOperations(sessionId);
        return operations.filter((op) => op.filePath === filePath);
    }
    /**
     * 删除session的所有操作记录
     */
    async deleteSessionOperations(sessionId) {
        const sessionDir = path.join(this.sessionsDir, sessionId);
        try {
            await fs.rm(sessionDir, { recursive: true, force: true });
            console.info(`✅ [OperationTracker] 删除session操作: ${sessionId}`);
        }
        catch (error) {
            console.warn(`⚠️ [OperationTracker] 删除session操作失败: ${sessionId}`, error);
        }
    }
    /**
     * 删除指定turn及之后的操作
     */
    async deleteOperationsFrom(sessionId, fromTurnIndex) {
        const operations = await this.getSessionOperations(sessionId);
        let deletedCount = 0;
        for (const op of operations) {
            if (op.turnIndex >= fromTurnIndex) {
                const operationFile = path.join(this.sessionsDir, sessionId, `${op.operationId}.json`);
                try {
                    await fs.unlink(operationFile);
                    deletedCount++;
                }
                catch (error) {
                    console.warn(`⚠️ [OperationTracker] 删除操作失败: ${op.operationId}`, error);
                }
            }
        }
        // 更新session信息
        await this.updateSessionInfo(sessionId);
        console.info(`✅ [OperationTracker] 删除操作: ${deletedCount} 个 (session: ${sessionId}, from turn: ${fromTurnIndex})`);
        return deletedCount;
    }
    /**
     * 获取session信息
     */
    async getSessionInfo(sessionId) {
        const infoFile = path.join(this.sessionsDir, sessionId, "info-session.json");
        try {
            const content = await fs.readFile(infoFile, "utf-8");
            return JSON.parse(content);
        }
        catch {
            return null;
        }
    }
    /**
     * 获取turn信息
     */
    async getTurnInfo(sessionId, turnIndex) {
        const infoFile = path.join(this.sessionsDir, sessionId, `info-turn-${turnIndex}.json`);
        try {
            const content = await fs.readFile(infoFile, "utf-8");
            return JSON.parse(content);
        }
        catch {
            return null;
        }
    }
    /**
     * 更新session信息
     */
    async updateSessionInfo(sessionId) {
        const operations = await this.getSessionOperations(sessionId);
        const affectedFiles = Array.from(new Set(operations.map((op) => op.filePath)));
        const info = {
            sessionId,
            affectedFiles,
            operationCount: operations.length,
            createdAt: operations[0]?.timestamp || Date.now(),
            updatedAt: Date.now(),
        };
        const infoFile = path.join(this.sessionsDir, sessionId, "info-session.json");
        await fs.writeFile(infoFile, JSON.stringify(info, null, 2), "utf-8");
    }
    /**
     * 列出所有session
     */
    async listSessions() {
        try {
            const dirs = await fs.readdir(this.sessionsDir);
            const sessions = [];
            for (const dir of dirs) {
                const dirPath = path.join(this.sessionsDir, dir);
                const stats = await fs.stat(dirPath);
                if (stats.isDirectory()) {
                    sessions.push(dir);
                }
            }
            return sessions;
        }
        catch {
            return [];
        }
    }
    /**
     * 清理过期session数据
     */
    async cleanupOldSessions(beforeTimestamp) {
        const sessions = await this.listSessions();
        let cleanedCount = 0;
        for (const sessionId of sessions) {
            const info = await this.getSessionInfo(sessionId);
            if (info && info.updatedAt < beforeTimestamp) {
                await this.deleteSessionOperations(sessionId);
                cleanedCount++;
            }
        }
        console.info(`✅ [OperationTracker] 清理过期session: ${cleanedCount} 个`);
        return cleanedCount;
    }
    /**
     * 获取session的turn列表
     */
    async getSessionTurns(sessionId) {
        const operations = await this.getSessionOperations(sessionId);
        const turns = new Set(operations.map((op) => op.turnIndex));
        return Array.from(turns).sort((a, b) => a - b);
    }
}
//# sourceMappingURL=operation_tracker.js.map