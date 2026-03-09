/**
 * Spec 工作流执行器
 * 作为 Spec 模式的入口，协调 WorkflowEngine 和 Agents
 */
import path from "node:path";
import fs from "node:fs/promises";
import { WorkflowEngine } from "./engine.js";
import { createDefaultWorkflow } from "./configs/default-workflow.js";
import { SpecificationPhase } from "./agents/specification-agent.js";
import { DesignPhase } from "./agents/design-agent.js";
import { PlanningPhase } from "./agents/planning-agent.js";
import { ExecutionPhase } from "./agents/execution-agent.js";
import { SummaryPhase } from "./agents/summary-agent.js";
import { SkillScanner } from "./skills/scanner.js";
import { SkillSelector } from "./skills/selector.js";
/**
 * 生成 YYYYMMDD_HHmmss 格式的时间戳
 */
function formatTimestamp(date) {
    const pad = (n) => n.toString().padStart(2, "0");
    return (`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
        `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`);
}
export class SpecWorkflowExecutor {
    engine;
    context;
    modelConfig;
    constructor(sessionId, turnId, userQuery, workspacePath, modelConfig, signal) {
        this.modelConfig = modelConfig;
        // 创建契约文件目录（迁移方案: .vcoder_ts/specs/YYYYMMDD_HHmmss）
        const timestamp = formatTimestamp(new Date());
        const specDir = path.join(workspacePath, ".vcoder_ts", "specs", timestamp).replace(/\\/g, "/");
        // 创建工作流上下文
        this.context = {
            sessionId,
            turnId,
            userQuery,
            workspacePath,
            phaseResults: new Map(),
            executionHistory: [],
            specDir,
            signal,
            feedbackHistory: new Map(),
            selectedSkills: [],
        };
        const phases = createDefaultWorkflow();
        const phasesRuntime = SpecWorkflowExecutor.createPhasesRuntime(modelConfig);
        this.engine = new WorkflowEngine(phases, phasesRuntime, this.context);
        console.info(`[Executor] created | sessionId=${sessionId}, specDir=${specDir}`);
    }
    /**
     * 从持久化状态恢复执行器
     * context 中已包含 phaseResults / executionHistory / feedbackHistory
     * engine 会跳过已完成阶段，直接进入等待循环
     */
    static restore(restoredContext, currentPhaseIndex, modelConfig, signal) {
        const executor = Object.create(SpecWorkflowExecutor.prototype);
        restoredContext.signal = signal;
        executor.context = restoredContext;
        const phases = createDefaultWorkflow();
        const phasesRuntime = SpecWorkflowExecutor.createPhasesRuntime(modelConfig);
        executor.engine = new WorkflowEngine(phases, phasesRuntime, restoredContext);
        executor.engine.setCurrentPhaseIndex(currentPhaseIndex);
        console.info(`[Executor] RESTORED | sessionId=${restoredContext.sessionId}, phaseIndex=${currentPhaseIndex}, completedPhases=[${restoredContext.executionHistory.join(',')}]`);
        return executor;
    }
    static createPhasesRuntime(modelConfig) {
        const phasesRuntime = new Map();
        const phaseInstances = [
            new SpecificationPhase(),
            new DesignPhase(),
            new PlanningPhase(),
            new ExecutionPhase(),
            new SummaryPhase(),
        ];
        for (const phaseRuntime of phaseInstances) {
            phaseRuntime.modelConfig = modelConfig;
            phasesRuntime.set(phaseRuntime.phaseId, phaseRuntime);
        }
        return phasesRuntime;
    }
    /**
     * 启动工作流
     */
    async start(sendEvent) {
        console.info(`[COVERAGE][Executor] start() 入口 | sessionId=${this.context.sessionId}, turnId=${this.context.turnId}, specDir=${this.context.specDir}`);
        // 确保契约文件目录存在
        try {
            await fs.mkdir(this.context.specDir, { recursive: true });
            console.info(`[COVERAGE][Executor] specDir目录创建成功 | specDir=${this.context.specDir}`);
        }
        catch (error) {
            console.error(`[COVERAGE][Executor] specDir目录创建失败 | specDir=${this.context.specDir}, error=${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
        // Skill 匹配：扫描 → LLM 选择 → 加载内容 → 注入上下文
        await this.matchAndLoadSkills(sendEvent);
        // 执行工作流
        try {
            await this.engine.execute(sendEvent);
            console.info(`[COVERAGE][Executor] start() 工作流执行完成 | sessionId=${this.context.sessionId}, finalStatus=${this.engine.getStatus()}`);
        }
        catch (error) {
            console.error(`[COVERAGE][Executor] start() 工作流执行异常 | sessionId=${this.context.sessionId}, error=${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : '');
            throw error;
        }
    }
    /**
     * 扫描、选择并加载 skills，结果写入 context.selectedSkills
     */
    async matchAndLoadSkills(sendEvent) {
        try {
            const scanner = new SkillScanner();
            const availableSkills = await scanner.scanSkills(this.context.workspacePath);
            if (availableSkills.length === 0) {
                console.info("[SpecWorkflowExecutor] No skills found, skipping skill selection");
                return;
            }
            const selector = new SkillSelector();
            const matched = await selector.selectSkills(this.context.userQuery, availableSkills, this.modelConfig);
            if (matched.length === 0) {
                console.info("[SpecWorkflowExecutor] No skills matched user query");
                return;
            }
            const loaded = await scanner.loadSkillContents(matched);
            this.context.selectedSkills = loaded.map((s) => ({
                name: s.name,
                description: s.description,
                content: s.content,
                appliesTo: s.appliesTo,
            }));
            console.info(`[SpecWorkflowExecutor] Loaded ${this.context.selectedSkills.length} skills: [${this.context.selectedSkills.map((s) => s.name).join(", ")}]`);
            // 通知前端选中了哪些 skills
            const payload = {
                sessionId: this.context.sessionId,
                turnId: this.context.turnId,
                selectedSkills: this.context.selectedSkills.map((s) => ({
                    name: s.name,
                    description: s.description,
                })),
            };
            sendEvent({
                event: "spec-workflow://skills-selected",
                payload: payload,
            });
        }
        catch (error) {
            console.error("[SpecWorkflowExecutor] Skill matching failed, continuing without skills:", error);
        }
    }
    /**
     * 处理用户操作
     */
    handleUserAction(action) {
        console.info(`[COVERAGE][Executor] handleUserAction() | sessionId=${this.context.sessionId}, actionType=${action.type}, currentStatus=${this.engine.getStatus()}, isWaiting=${this.engine.isWaitingForAction()}`);
        this.engine.handleUserAction(action);
    }
    /**
     * 获取当前状态
     */
    getStatus() {
        return this.engine.getStatus();
    }
    /**
     * 是否正在等待用户操作
     */
    isWaitingForAction() {
        return this.engine.isWaitingForAction();
    }
    /**
     * 获取工作流上下文
     */
    getContext() {
        return this.context;
    }
    /**
     * 重新发送工作流定义和阶段状态（前端重连后恢复用）
     * 同时更新事件回调，确保后续事件发到新连接
     */
    reEmitState(sendEvent) {
        this.engine.reEmitState(sendEvent);
    }
    /**
     * 更新事件发送回调（前端 WebSocket 重连时调用）
     */
    updateSendEvent(sendEvent) {
        this.engine.updateSendEvent(sendEvent);
    }
}
//# sourceMappingURL=executor.js.map