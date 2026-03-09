/**
 * Session管理器 - 实现上下文回滚功能
 *
 * 对标Rust版本：
 * - backend/vcoder/crates/core/src/agentic/session/session_manager.rs
 * - rollback_context_to_turn_start 功能
 */
import { promises as fs } from "node:fs";
import path from "node:path";
/**
 * SessionManager - 管理session的上下文和回滚
 */
export class SessionManager {
    workspacePath;
    constructor(workspacePath) {
        this.workspacePath = workspacePath ?? process.cwd();
    }
    /**
     * 获取session的快照目录
     */
    getSessionSnapshotDir(sessionId) {
        return path.join(this.workspacePath, ".vcoder_ts", "sessions", sessionId, "snapshots");
    }
    /**
     * 获取turn快照文件路径
     */
    getTurnSnapshotPath(sessionId, turnIndex) {
        const dir = this.getSessionSnapshotDir(sessionId);
        return path.join(dir, `turn-${String(turnIndex).padStart(4, "0")}.json`);
    }
    /**
     * 保存turn上下文快照（在每次turn结束后调用）
     *
     * @param sessionId 会话ID
     * @param turnIndex turn索引
     * @param messages 当前的消息历史
     */
    async saveTurnContextSnapshot(sessionId, turnIndex, messages) {
        const snapshot = {
            session_id: sessionId,
            turn_index: turnIndex,
            messages: [...messages], // 深拷贝
            created_at: Date.now(),
        };
        const snapshotPath = this.getTurnSnapshotPath(sessionId, turnIndex);
        const dir = path.dirname(snapshotPath);
        // 确保目录存在
        await fs.mkdir(dir, { recursive: true });
        // 保存快照
        await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
        console.info(`✅ [SessionManager] 保存turn快照: session=${sessionId}, turn=${turnIndex}, messages=${messages.length}`);
    }
    /**
     * 加载turn上下文快照
     *
     * @param sessionId 会话ID
     * @param turnIndex turn索引
     * @returns 快照数据，如果不存在返回null
     */
    async loadTurnContextSnapshot(sessionId, turnIndex) {
        const snapshotPath = this.getTurnSnapshotPath(sessionId, turnIndex);
        try {
            const raw = await fs.readFile(snapshotPath, "utf8");
            const snapshot = JSON.parse(raw);
            console.info(`✅ [SessionManager] 加载turn快照: session=${sessionId}, turn=${turnIndex}, messages=${snapshot.messages.length}`);
            return snapshot;
        }
        catch (error) {
            // 文件不存在或解析失败
            console.warn(`⚠️ [SessionManager] turn快照不存在或加载失败: session=${sessionId}, turn=${turnIndex}`);
            return null;
        }
    }
    /**
     * 删除指定turn及之后的所有快照
     *
     * @param sessionId 会话ID
     * @param fromTurnIndex 起始turn索引（包含）
     */
    async deleteTurnContextSnapshotsFrom(sessionId, fromTurnIndex) {
        const dir = this.getSessionSnapshotDir(sessionId);
        try {
            // 检查目录是否存在
            await fs.access(dir);
        }
        catch {
            // 目录不存在，无需删除
            return 0;
        }
        // 读取目录中的所有快照文件
        const files = await fs.readdir(dir);
        let deletedCount = 0;
        for (const file of files) {
            // 解析文件名: turn-0000.json
            const match = file.match(/^turn-(\d+)\.json$/);
            if (!match) {
                continue;
            }
            const turnIndex = parseInt(match[1], 10);
            if (turnIndex >= fromTurnIndex) {
                const filePath = path.join(dir, file);
                try {
                    await fs.unlink(filePath);
                    deletedCount++;
                    console.info(`✅ [SessionManager] 删除turn快照: ${file}`);
                }
                catch (error) {
                    console.warn(`⚠️ [SessionManager] 删除turn快照失败: ${file}`, error);
                }
            }
        }
        console.info(`✅ [SessionManager] 共删除 ${deletedCount} 个turn快照`);
        return deletedCount;
    }
    /**
     * 回滚上下文到指定turn的开始之前（即保留 0..targetTurn-1）
     *
     * 对标Rust: SessionManager::rollback_context_to_turn_start
     *
     * @param session 会话对象
     * @param targetTurn 目标turn索引（将回滚到此turn之前）
     * @returns 回滚后的消息列表
     */
    async rollbackContextToTurnStart(session, targetTurn) {
        console.info(`⏪ [SessionManager] 回滚上下文到turn ${targetTurn}之前: session=${session.sessionId}`);
        // 1. 加载目标上下文（targetTurn == 0 => 空上下文）
        let messages = [];
        if (targetTurn === 0) {
            // 回滚到最开始，清空所有消息
            console.info(`⏪ [SessionManager] 回滚到turn 0，清空所有消息`);
            messages = [];
        }
        else {
            // 加载 targetTurn - 1 的快照
            const snapshot = await this.loadTurnContextSnapshot(session.sessionId, targetTurn - 1);
            if (!snapshot) {
                throw new Error(`turn context snapshot not found: session_id=${session.sessionId} turn=${targetTurn - 1}`);
            }
            messages = snapshot.messages;
            console.info(`⏪ [SessionManager] 加载turn ${targetTurn - 1}的快照: ${messages.length} 条消息`);
        }
        // 2. 截断session的turn列表
        if (session.turns.length > targetTurn) {
            const removedCount = session.turns.length - targetTurn;
            session.turns = session.turns.slice(0, targetTurn);
            console.info(`⏪ [SessionManager] 截断turn列表: 移除 ${removedCount} 个turn，剩余 ${session.turns.length}`);
        }
        // 3. 更新session的turnCount
        session.turnCount = targetTurn;
        // 4. 更新session状态
        session.state = "idle";
        // 5. 删除 targetTurn（含）之后的快照
        await this.deleteTurnContextSnapshotsFrom(session.sessionId, targetTurn);
        // 6. 返回回滚后的消息列表
        console.info(`✅ [SessionManager] 上下文回滚完成: session=${session.sessionId}, turn=${targetTurn}, messages=${messages.length}`);
        return messages;
    }
    /**
     * 删除指定turn之后的所有turn数据（不包含targetTurn）
     *
     * @param sessionId 会话ID
     * @param targetTurn 目标turn索引
     */
    async deleteTurnsAfter(sessionId, targetTurn) {
        return await this.deleteTurnContextSnapshotsFrom(sessionId, targetTurn + 1);
    }
    /**
     * 删除指定turn及之后的所有turn数据（包含targetTurn）
     *
     * @param sessionId 会话ID
     * @param targetTurn 目标turn索引
     */
    async deleteTurnsFrom(sessionId, targetTurn) {
        return await this.deleteTurnContextSnapshotsFrom(sessionId, targetTurn);
    }
    /**
     * 清理session的所有快照数据
     *
     * @param sessionId 会话ID
     */
    async cleanupSessionSnapshots(sessionId) {
        const dir = this.getSessionSnapshotDir(sessionId);
        try {
            await fs.rm(dir, { recursive: true, force: true });
            console.info(`✅ [SessionManager] 清理session快照: ${sessionId}`);
        }
        catch (error) {
            console.warn(`⚠️ [SessionManager] 清理session快照失败: ${sessionId}`, error);
        }
    }
    /**
     * 获取session的所有turn快照列表
     *
     * @param sessionId 会话ID
     * @returns turn索引数组
     */
    async listTurnSnapshots(sessionId) {
        const dir = this.getSessionSnapshotDir(sessionId);
        try {
            const files = await fs.readdir(dir);
            const turnIndices = [];
            for (const file of files) {
                const match = file.match(/^turn-(\d+)\.json$/);
                if (match) {
                    turnIndices.push(parseInt(match[1], 10));
                }
            }
            return turnIndices.sort((a, b) => a - b);
        }
        catch {
            return [];
        }
    }
}
//# sourceMappingURL=session_manager.js.map