import { genId } from "./utils.js";
import { Storage } from "./store.js";
import { getGlobalToolRegistry } from "./tools/registry.js";
import { SessionManager } from "./session_manager.js";
import { SnapshotManager } from "./snapshot/index.js";
import { WorkflowMessageRouter } from "./spec-workflow/router.js";
export class AppContext {
    startedAt = Date.now();
    version = "0.1.0-ts";
    storage;
    sessionManager;
    snapshotManager;
    workflowRouter;
    workspacePath;
    runningTurns = new Map();
    mcpJsonConfig = "{}";
    constructor(workspacePath) {
        this.workspacePath = workspacePath;
        this.storage = new Storage(workspacePath);
        this.sessionManager = new SessionManager(workspacePath);
        this.snapshotManager = new SnapshotManager(workspacePath || process.cwd());
        this.workflowRouter = new WorkflowMessageRouter();
    }
    async init() {
        await this.storage.init();
        await this.snapshotManager.initialize();
    }
    listSessions() {
        return this.storage.getSessions();
    }
    getSession(sessionId) {
        return this.storage.getSession(sessionId);
    }
    async saveSession(session) {
        this.storage.upsertSession(session);
        await this.storage.saveSessions();
    }
    async removeSession(sessionId) {
        this.storage.deleteSession(sessionId);
        await this.storage.saveSessions();
    }
    getConfigState() {
        return this.storage.getConfigState();
    }
    async saveConfigState() {
        await this.storage.saveConfig();
    }
    getAvailableModes() {
        const defaults = this.storage.getDefaultModes();
        const modeConfigs = this.storage.getConfigState().modeConfigs;
        return defaults.map((m) => {
            const override = modeConfigs[m.id];
            return {
                ...m,
                toolCount: override?.available_tools?.length ?? m.toolCount,
                defaultTools: override?.default_tools ?? m.defaultTools,
                enabled: override?.enabled ?? m.enabled,
            };
        });
    }
    getBuiltinSubagents() {
        return [
            {
                id: "generalPurpose",
                name: "General Purpose",
                description: "General-purpose assistant for coding tasks",
                isReadonly: false,
                toolCount: 6,
                defaultTools: ["ReadFile", "LS", "rg", "Shell", "ApplyPatch", "Glob"],
                enabled: true,
            },
            {
                id: "explore",
                name: "Explore",
                description: "Codebase exploration specialist",
                isReadonly: true,
                toolCount: 3,
                defaultTools: ["ReadFile", "LS", "rg"],
                enabled: true,
            },
            {
                id: "browser-use",
                name: "Browser Use",
                description: "Browser automation specialist",
                isReadonly: false,
                toolCount: 2,
                defaultTools: ["browser_navigate", "browser_click"],
                enabled: true,
            },
        ];
    }
    getToolInfos() {
        const registry = getGlobalToolRegistry();
        const tools = registry.get_all_tools();
        return tools.map((tool) => {
            const def = tool.get_definition();
            return {
                name: def.name,
                description: def.description,
                input_schema: def.input_schema,
                is_readonly: tool.name === "Read" || tool.name === "LS" || tool.name === "Grep" || tool.name === "Glob",
                is_concurrency_safe: tool.name !== "Shell",
                needs_permissions: tool.name === "Shell" || tool.name === "Write" || tool.name === "Delete",
            };
        });
    }
    findModelConfig(agentType) {
        const models = this.storage.getConfigState().modelConfigs;
        const enabled = models.filter((m) => m.enabled !== false);
        const all = enabled.length > 0 ? enabled : [];
        if (all.length === 0) {
            return undefined;
        }
        const cfgValues = this.storage.getConfigState().values;
        const ai = (cfgValues.ai && typeof cfgValues.ai === "object"
            ? cfgValues.ai
            : {});
        const agentModels = ai.agent_models && typeof ai.agent_models === "object" && !Array.isArray(ai.agent_models)
            ? ai.agent_models
            : {};
        const defaultModels = ai.default_models && typeof ai.default_models === "object" && !Array.isArray(ai.default_models)
            ? ai.default_models
            : {};
        const resolveById = (id) => all.find((m) => m.id === id);
        const primaryId = typeof defaultModels.primary === "string" ? defaultModels.primary : undefined;
        const fastId = typeof defaultModels.fast === "string" ? defaultModels.fast : undefined;
        if (agentType) {
            const mapped = agentModels[agentType];
            if (typeof mapped === "string") {
                if (mapped === "primary" && primaryId) {
                    const model = resolveById(primaryId);
                    if (model)
                        return model;
                }
                if (mapped === "fast" && fastId) {
                    const model = resolveById(fastId);
                    if (model)
                        return model;
                }
                const model = resolveById(mapped);
                if (model)
                    return model;
            }
        }
        if (primaryId) {
            const model = resolveById(primaryId);
            if (model)
                return model;
        }
        if (fastId) {
            const model = resolveById(fastId);
            if (model)
                return model;
        }
        return all[0];
    }
    beginTurn(sessionId, turnId) {
        const id = turnId ?? genId("t");
        const key = `${sessionId}:${id}`;
        const controller = new AbortController();
        this.runningTurns.set(key, { sessionId, turnId: id, controller });
        return { turnId: id, signal: controller.signal };
    }
    cancelTurn(sessionId, turnId) {
        const key = `${sessionId}:${turnId}`;
        const running = this.runningTurns.get(key);
        if (!running) {
            return false;
        }
        running.controller.abort();
        this.runningTurns.delete(key);
        return true;
    }
    endTurn(sessionId, turnId) {
        this.runningTurns.delete(`${sessionId}:${turnId}`);
    }
    getMcpJsonConfig() {
        return this.mcpJsonConfig;
    }
    setMcpJsonConfig(json) {
        this.mcpJsonConfig = json;
    }
    getWorkspacePath() {
        return this.workspacePath;
    }
    /**
     * 切换 workspace 路径，重新加载该 workspace 下的 sessions
     */
    async switchWorkspace(newWorkspacePath) {
        this.workspacePath = newWorkspacePath;
        await this.storage.switchWorkspace(newWorkspacePath);
    }
    /**
     * 回滚session上下文到指定turn之前
     *
     * @param sessionId 会话ID
     * @param targetTurn 目标turn索引（回滚到此turn之前，保留0..targetTurn-1）
     * @returns 回滚后的消息列表
     */
    async rollbackContextToTurn(sessionId, targetTurn) {
        const session = this.getSession(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        // 执行回滚
        const messages = await this.sessionManager.rollbackContextToTurnStart(session, targetTurn);
        // 更新session的messages
        session.messages = messages;
        // 保存session
        await this.saveSession(session);
        console.info(`✅ [AppContext] 上下文回滚完成: session=${sessionId}, turn=${targetTurn}, messages=${messages.length}`);
        return messages;
    }
    /**
     * 保存turn上下文快照
     *
     * @param sessionId 会话ID
     * @param turnIndex turn索引
     * @param messages 消息历史
     */
    async saveTurnSnapshot(sessionId, turnIndex, messages) {
        await this.sessionManager.saveTurnContextSnapshot(sessionId, turnIndex, messages);
    }
    /**
     * 清理session的所有快照
     *
     * @param sessionId 会话ID
     */
    async cleanupSessionSnapshots(sessionId) {
        await this.sessionManager.cleanupSessionSnapshots(sessionId);
        // 同时清理文件快照
        await this.snapshotManager.deleteSession(sessionId);
    }
    /**
     * 回滚session的文件修改
     *
     * @param sessionId 会话ID
     */
    async rollbackSessionFiles(sessionId) {
        return await this.snapshotManager.rollbackSession(sessionId);
    }
    /**
     * 回滚到指定turn的文件修改
     *
     * @param sessionId 会话ID
     * @param turnIndex Turn索引
     */
    async rollbackToTurnFiles(sessionId, turnIndex) {
        return await this.snapshotManager.rollbackToTurn(sessionId, turnIndex);
    }
    /**
     * 获取session影响的文件列表
     *
     * @param sessionId 会话ID
     */
    async getSessionModifiedFiles(sessionId) {
        return await this.snapshotManager.getSessionFiles(sessionId);
    }
    /**
     * 获取文件变更历史
     *
     * @param sessionId 会话ID
     * @param filePath 文件路径
     */
    async getFileChangeHistory(sessionId, filePath) {
        return await this.snapshotManager.getFileChangeHistory(sessionId, filePath);
    }
    /**
     * 接受session的文件修改
     *
     * @param sessionId 会话ID
     */
    async acceptSessionChanges(sessionId) {
        await this.snapshotManager.acceptSession(sessionId);
    }
    /**
     * 获取快照统计信息
     */
    async getSnapshotStats() {
        return await this.snapshotManager.getStats();
    }
}
//# sourceMappingURL=context.js.map