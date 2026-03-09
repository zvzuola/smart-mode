import { promises as fs } from "node:fs";
import path from "node:path";
const DEFAULT_MODES = [
    {
        id: "HarmonyOSDev",
        name: "HarmonyOSDev",
        description: "HarmonyOS development mode",
        isReadonly: false,
        toolCount: 6,
        defaultTools: ["ReadFile", "LS", "rg", "Shell", "ApplyPatch", "Glob"],
        enabled: true,
    },
    {
        id: "agentic",
        name: "Agentic",
        description: "General coding assistant mode",
        isReadonly: false,
        toolCount: 6,
        defaultTools: ["ReadFile", "LS", "rg", "Shell", "ApplyPatch", "Glob"],
        enabled: true,
    },
    {
        id: "Plan",
        name: "Plan",
        description: "Planning mode",
        isReadonly: true,
        toolCount: 3,
        defaultTools: ["ReadFile", "LS", "rg"],
        enabled: true,
    },
    {
        id: "debug",
        name: "Debug",
        description: "Debugging mode",
        isReadonly: false,
        toolCount: 5,
        defaultTools: ["ReadFile", "LS", "rg", "Shell", "ApplyPatch"],
        enabled: true,
    },
    {
        id: "HarmonyOSAutoDebug",
        name: "HarmonyOSAutoDebug",
        description: "HarmonyOS auto debug mode",
        isReadonly: false,
        toolCount: 5,
        defaultTools: ["ReadFile", "LS", "rg", "Shell", "ApplyPatch"],
        enabled: true,
    },
    {
        id: "visual-programming",
        name: "Visual Programming",
        description: "Visual programming mode",
        isReadonly: false,
        toolCount: 4,
        defaultTools: ["ReadFile", "LS", "rg", "ApplyPatch"],
        enabled: true,
    },
    {
        id: "requirement",
        name: "Requirement",
        description: "Requirement analysis mode",
        isReadonly: true,
        toolCount: 3,
        defaultTools: ["ReadFile", "LS", "rg"],
        enabled: true,
    },
    {
        id: "ui-design",
        name: "UI Design",
        description: "UI design mode",
        isReadonly: true,
        toolCount: 3,
        defaultTools: ["ReadFile", "LS", "rg"],
        enabled: true,
    },
    {
        id: "ask",
        name: "Ask",
        description: "Read-only Q&A mode",
        isReadonly: true,
        toolCount: 3,
        defaultTools: ["ReadFile", "LS", "rg"],
        enabled: true,
    },
    {
        id: "spec_workflow",
        name: "Spec Workflow",
        description: "需求分析 → 架构设计 → 任务规划 → 代码执行 → 总结报告",
        isReadonly: false,
        toolCount: 9,
        defaultTools: ["Read", "Write", "Shell", "StrReplace", "Delete", "LS", "Glob", "Grep", "Git"],
        enabled: true,
    },
];
// 与 Rust ConfigManager::add_default_agent_models_config 对齐
const AGENTS_USING_FAST = [
    "Explore",
    "FileFinder",
    "GenerateDoc",
    "HarmonyOSExpert",
    "CodeReview",
    "compression",
    "arc-func-agent",
    "startchat-fuc-agent",
    "git-fuc-agent",
];
export class Storage {
    initialWorkspacePath;
    sessions = new Map();
    config = {
        values: {
            ai: {
                models: [],
                default_models: {
                    primary: null,
                    fast: null,
                    search: null,
                    image_understanding: null,
                    image_generation: null,
                    phone_agent: null,
                    speech_recognition: null,
                },
                agent_models: {},
                mode_configs: {},
                subagent_configs: {},
            },
        },
        modelConfigs: [],
        modeConfigs: {},
        subagentConfigs: {},
        mcpServers: [],
    };
    currentWorkspacePath;
    serverDataDir;
    constructor(initialWorkspacePath) {
        this.initialWorkspacePath = initialWorkspacePath;
        this.currentWorkspacePath = initialWorkspacePath;
        this.serverDataDir = path.join(initialWorkspacePath ?? process.cwd(), ".vcoder_ts");
    }
    get dataDir() {
        const root = this.currentWorkspacePath ?? process.cwd();
        return path.join(root, ".vcoder_ts");
    }
    get sessionsPath() {
        return path.join(this.dataDir, "sessions.json");
    }
    get configPath() {
        return path.join(this.serverDataDir, "config.json");
    }
    async init() {
        await fs.mkdir(this.dataDir, { recursive: true });
        await fs.mkdir(this.serverDataDir, { recursive: true });
        await this.loadSessions();
        await this.loadConfig();
        await this.bootstrapFromLegacyConfigIfNeeded();
        await this.injectDefaultModelsIfNeeded();
    }
    /**
     * 切换 workspace 路径，重新加载 sessions
     * config 保留在服务器级别目录，不随 workspace 切换
     * 自动迁移：如果新 workspace 下无 sessions.json，将内存中属于该 workspace 的 session 迁移过去
     */
    async switchWorkspace(newWorkspacePath) {
        console.info(`[Storage] switchWorkspace | from=${this.currentWorkspacePath ?? 'cwd'} to=${newWorkspacePath}`);
        const normalizedNew = path.resolve(newWorkspacePath);
        // 保存当前内存中属于目标 workspace 的 sessions（用于迁移）
        const sessionsToMigrate = Array.from(this.sessions.values())
            .filter(s => s.workspacePath && path.resolve(s.workspacePath) === normalizedNew);
        this.currentWorkspacePath = newWorkspacePath;
        await fs.mkdir(this.dataDir, { recursive: true });
        await this.loadSessions();
        // 如果新 workspace 没有 sessions，将旧内存中匹配的 sessions 迁移过来
        if (this.sessions.size === 0 && sessionsToMigrate.length > 0) {
            console.info(`[Storage] migrating ${sessionsToMigrate.length} sessions to workspace ${newWorkspacePath}`);
            for (const session of sessionsToMigrate) {
                this.sessions.set(session.sessionId, session);
            }
            await this.saveSessions();
        }
    }
    getDefaultModes() {
        return DEFAULT_MODES;
    }
    getSessions() {
        return Array.from(this.sessions.values()).sort((a, b) => b.createdAt - a.createdAt);
    }
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    upsertSession(session) {
        this.sessions.set(session.sessionId, session);
    }
    deleteSession(sessionId) {
        return this.sessions.delete(sessionId);
    }
    async saveSessions() {
        const raw = JSON.stringify(Array.from(this.sessions.values()), null, 2);
        await fs.writeFile(this.sessionsPath, raw, "utf8");
    }
    getConfigState() {
        return this.config;
    }
    setConfigState(next) {
        this.config = next;
    }
    async saveConfig() {
        await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), "utf8");
    }
    async loadSessions() {
        try {
            const raw = await fs.readFile(this.sessionsPath, "utf8");
            const list = JSON.parse(raw);
            this.sessions = new Map(list.map((s) => [s.sessionId, s]));
        }
        catch {
            this.sessions.clear();
        }
    }
    async loadConfig() {
        try {
            const raw = await fs.readFile(this.configPath, "utf8");
            const data = JSON.parse(raw);
            this.config = {
                values: data.values ?? {
                    ai: {
                        models: [],
                        default_models: {
                            primary: null,
                            fast: null,
                            search: null,
                            image_understanding: null,
                            image_generation: null,
                            phone_agent: null,
                            speech_recognition: null,
                        },
                        agent_models: {},
                        mode_configs: {},
                        subagent_configs: {},
                    },
                },
                modelConfigs: data.modelConfigs ?? [],
                modeConfigs: data.modeConfigs ?? {},
                subagentConfigs: data.subagentConfigs ?? {},
                mcpServers: data.mcpServers ?? [],
            };
            const root = this.config.values;
            if (!root.ai || typeof root.ai !== "object" || Array.isArray(root.ai)) {
                root.ai = {};
            }
            const ai = root.ai;
            if (!Array.isArray(ai.models)) {
                ai.models = [];
            }
            if (!ai.default_models || typeof ai.default_models !== "object" || Array.isArray(ai.default_models)) {
                ai.default_models = {
                    primary: null,
                    fast: null,
                    search: null,
                    image_understanding: null,
                    image_generation: null,
                    phone_agent: null,
                    speech_recognition: null,
                };
            }
            else {
                const defaults = ai.default_models;
                if (!("primary" in defaults))
                    defaults.primary = null;
                if (!("fast" in defaults))
                    defaults.fast = null;
                if (!("search" in defaults))
                    defaults.search = null;
                if (!("image_understanding" in defaults))
                    defaults.image_understanding = null;
                if (!("image_generation" in defaults))
                    defaults.image_generation = null;
                if (!("phone_agent" in defaults))
                    defaults.phone_agent = null;
                if (!("speech_recognition" in defaults))
                    defaults.speech_recognition = null;
            }
            if (!ai.agent_models || typeof ai.agent_models !== "object" || Array.isArray(ai.agent_models)) {
                ai.agent_models = {};
            }
            if (!ai.mode_configs || typeof ai.mode_configs !== "object" || Array.isArray(ai.mode_configs)) {
                ai.mode_configs = {};
            }
            if (!ai.subagent_configs || typeof ai.subagent_configs !== "object" || Array.isArray(ai.subagent_configs)) {
                ai.subagent_configs = {};
            }
        }
        catch {
            this.config = {
                values: {
                    ai: {
                        models: [],
                        default_models: {
                            primary: null,
                            fast: null,
                            search: null,
                            image_understanding: null,
                            image_generation: null,
                            phone_agent: null,
                            speech_recognition: null,
                        },
                        agent_models: {},
                        mode_configs: {},
                        subagent_configs: {},
                    },
                },
                modelConfigs: [],
                modeConfigs: {},
                subagentConfigs: {},
                mcpServers: [],
            };
        }
    }
    async bootstrapFromLegacyConfigIfNeeded() {
        const hasModels = this.config.modelConfigs.length > 0;
        const values = this.config.values;
        const ai = values.ai && typeof values.ai === "object" && !Array.isArray(values.ai)
            ? values.ai
            : {};
        const defaults = ai.default_models && typeof ai.default_models === "object" && !Array.isArray(ai.default_models)
            ? ai.default_models
            : {};
        const hasDefaultModel = typeof defaults.primary === "string" || typeof defaults.fast === "string";
        if (hasModels || hasDefaultModel) {
            return;
        }
        const candidates = this.getLegacyConfigCandidates();
        for (const file of candidates) {
            try {
                const raw = await fs.readFile(file, "utf8");
                const parsed = JSON.parse(raw);
                const sourceAi = parsed.ai && typeof parsed.ai === "object" && !Array.isArray(parsed.ai)
                    ? parsed.ai
                    : null;
                if (!sourceAi) {
                    continue;
                }
                const sourceModels = Array.isArray(sourceAi.models) ? sourceAi.models : [];
                const sourceDefaultModels = sourceAi.default_models && typeof sourceAi.default_models === "object" && !Array.isArray(sourceAi.default_models)
                    ? sourceAi.default_models
                    : {};
                const sourceAgentModels = sourceAi.agent_models && typeof sourceAi.agent_models === "object" && !Array.isArray(sourceAi.agent_models)
                    ? sourceAi.agent_models
                    : {};
                const sourceModeConfigs = sourceAi.mode_configs && typeof sourceAi.mode_configs === "object" && !Array.isArray(sourceAi.mode_configs)
                    ? sourceAi.mode_configs
                    : {};
                const sourceSubagentConfigs = sourceAi.subagent_configs && typeof sourceAi.subagent_configs === "object" && !Array.isArray(sourceAi.subagent_configs)
                    ? sourceAi.subagent_configs
                    : {};
                if (sourceModels.length === 0 && Object.keys(sourceDefaultModels).length === 0) {
                    continue;
                }
                this.config.modelConfigs = sourceModels;
                this.config.modeConfigs = sourceModeConfigs;
                this.config.subagentConfigs = sourceSubagentConfigs;
                ai.models = sourceModels;
                ai.default_models = {
                    primary: sourceDefaultModels.primary ?? null,
                    fast: sourceDefaultModels.fast ?? null,
                    search: sourceDefaultModels.search ?? null,
                    image_understanding: sourceDefaultModels.image_understanding ?? null,
                    image_generation: sourceDefaultModels.image_generation ?? null,
                    phone_agent: sourceDefaultModels.phone_agent ?? null,
                    speech_recognition: sourceDefaultModels.speech_recognition ?? null,
                };
                ai.agent_models = sourceAgentModels;
                ai.mode_configs = sourceModeConfigs;
                ai.subagent_configs = sourceSubagentConfigs;
                values.ai = ai;
                await this.saveConfig();
                return;
            }
            catch {
                // ignore candidate read/parse errors
            }
        }
    }
    getLegacyConfigCandidates() {
        const list = [];
        if (this.currentWorkspacePath) {
            list.push(path.join(this.currentWorkspacePath, ".vcoder", "config.json"));
        }
        const appData = process.env.APPDATA;
        if (appData) {
            list.push(path.join(appData, "v-coder", "app.json"));
        }
        const home = process.env.USERPROFILE ?? process.env.HOME;
        if (home) {
            list.push(path.join(home, ".config", "v-coder", "app.json"));
            list.push(path.join(home, "AppData", "Roaming", "v-coder", "app.json"));
        }
        return Array.from(new Set(list));
    }
    async injectDefaultModelsIfNeeded() {
        const values = this.config.values;
        if (!values.ai || typeof values.ai !== "object" || Array.isArray(values.ai)) {
            values.ai = {};
        }
        const ai = values.ai;
        if (!Array.isArray(ai.models)) {
            ai.models = [];
        }
        const models = ai.models;
        let changed = false;
        // 1) 没有任何模型时，注入默认模型
        if (models.length === 0) {
            const injected = this.createInjectedModelsFromEnv();
            models.push(...injected);
            changed = injected.length > 0;
        }
        // 1.1) 兼容历史注入：如果存在模型但没有任何启用模型，补一个 deepseek-chat
        const hasEnabledModel = models.some((m) => m.enabled !== false);
        if (!hasEnabledModel) {
            const deepseek = this.createDefaultDeepSeekModel();
            if (!models.some((m) => m.id === deepseek.id)) {
                models.push(deepseek);
            }
            else {
                // 若已存在同 ID 模型但被禁用，强制启用
                for (const m of models) {
                    if (m.id === deepseek.id) {
                        m.enabled = true;
                        if (!m.model_name)
                            m.model_name = deepseek.model_name;
                        if (!m.base_url)
                            m.base_url = deepseek.base_url;
                        if (!m.provider)
                            m.provider = deepseek.provider;
                    }
                }
            }
            changed = true;
        }
        // 1.2) 若 deepseek 模型存在但 api_key 为空，尝试从环境变量回填
        const envDeepseekKey = process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.VCODER_API_KEY ?? "";
        if (envDeepseekKey) {
            for (const m of models) {
                const isDeepSeek = m.id === "deepseek-chat" ||
                    m.model_name?.toLowerCase().includes("deepseek") ||
                    m.base_url?.toLowerCase().includes("deepseek");
                if (isDeepSeek && (!m.api_key || m.api_key.trim().length === 0)) {
                    m.api_key = envDeepseekKey;
                    m.enabled = true;
                    changed = true;
                }
            }
        }
        // 2) default_models 缺失时自动补齐 primary/fast（对齐 Rust 的默认模型槽）
        if (!ai.default_models || typeof ai.default_models !== "object" || Array.isArray(ai.default_models)) {
            ai.default_models = {};
            changed = true;
        }
        const defaultModels = ai.default_models;
        const firstEnabledModelId = models.find((m) => m.enabled !== false)?.id ?? null;
        const primaryFallback = firstEnabledModelId ?? models[0]?.id ?? null;
        const isEnabledModelId = (id) => typeof id === "string" && models.some((m) => m.id === id && m.enabled !== false);
        if (!isEnabledModelId(defaultModels.primary) && primaryFallback) {
            defaultModels.primary = primaryFallback;
            changed = true;
        }
        if (!isEnabledModelId(defaultModels.fast) && primaryFallback) {
            defaultModels.fast = primaryFallback;
            changed = true;
        }
        if (!("search" in defaultModels))
            defaultModels.search = null;
        if (!("image_understanding" in defaultModels))
            defaultModels.image_understanding = null;
        if (!("image_generation" in defaultModels))
            defaultModels.image_generation = null;
        if (!("phone_agent" in defaultModels))
            defaultModels.phone_agent = null;
        if (!("speech_recognition" in defaultModels))
            defaultModels.speech_recognition = null;
        // 3) agent_models 缺失默认 key 时注入 fast 映射（对齐 Rust）
        if (!ai.agent_models || typeof ai.agent_models !== "object" || Array.isArray(ai.agent_models)) {
            ai.agent_models = {};
            changed = true;
        }
        const agentModels = ai.agent_models;
        for (const key of AGENTS_USING_FAST) {
            if (!(key in agentModels)) {
                agentModels[key] = "fast";
                changed = true;
            }
        }
        // 同步内存态快捷字段
        this.config.modelConfigs = models;
        if (ai.mode_configs && typeof ai.mode_configs === "object" && !Array.isArray(ai.mode_configs)) {
            this.config.modeConfigs = ai.mode_configs;
        }
        if (ai.subagent_configs && typeof ai.subagent_configs === "object" && !Array.isArray(ai.subagent_configs)) {
            this.config.subagentConfigs = ai.subagent_configs;
        }
        if (changed) {
            await this.saveConfig();
        }
    }
    createInjectedModelsFromEnv() {
        // 与 Rust 默认模型风格对齐：直接提供 deepseek-chat
        return [this.createDefaultDeepSeekModel()];
    }
    createDefaultDeepSeekModel() {
        const env = process.env;
        return {
            id: "deepseek-chat",
            name: "DeepSeek Chat",
            provider: "openai",
            model_name: "deepseek-chat",
            base_url: "https://api.deepseek.com/v1/chat/completions",
            api_key: env.DEEPSEEK_API_KEY ?? env.OPENAI_API_KEY ?? env.VCODER_API_KEY ?? "",
            enabled: true,
            context_window: 128000,
            max_tokens: 65536,
            enable_thinking_process: false,
            support_preserved_thinking: false,
            skip_ssl_verify: false,
        };
    }
}
//# sourceMappingURL=store.js.map