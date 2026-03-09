/**
 * Spec 工作流 Agent 基类
 * 仅承载 AI 交互能力（prompt 构建、回合循环、工具调用、反馈对话）
 */
import path from "node:path";
import { RoundExecutor } from "../../execution/round_executor.js";
import { getEmbeddedPrompt } from "../../prompt/index.js";
import { PromptBuilder } from "../../prompt/prompt_builder.js";
import { getAllToolDefinitions } from "../../tools/registry.js";
import { LoopDetector } from "../loop_detector.js";
import { PhaseStatus } from "../models.js";
/**
 * Spec 工作流 Agent 基类（组合 RoundExecutor，替代继承模式）
 * 每个阶段 Agent 继承此类并实现 phaseId, promptTemplate, buildPhaseContext
 */
export class SpecWorkflowAgent {
    /** 模型配置（由外部注入） */
    modelConfig;
    /** 组合 RoundExecutor（而非继承） */
    roundExecutor = new RoundExecutor();
    /**
     * 子类可覆盖以排除特定工具。
     * 返回值为工具名（注册名），如 HmosCompilation / CompilationFix。
     */
    getExcludedToolNames() {
        return [];
    }
    /**
     * 子类可覆盖：显式指定允许的工具列表。
     * 当返回值非空时，优先级高于 getExcludedToolNames。
     */
    getAllowedToolNames() {
        return undefined;
    }
    /**
     * 子类可覆盖：调整循环检测参数。
     */
    getLoopDetectorConfig() {
        return {};
    }
    /**
     * 构建阶段专用的上下文信息，注入到 prompt 中
     * 子类可覆盖以提供更多上下文
     */
    buildPhaseContext(ctx) {
        const parts = [];
        // 用户原始需求
        parts.push(`## 用户需求\n${ctx.userQuery}`);
        // 契约文件目录
        parts.push(`## 契约文件目录\n${ctx.specDir}`);
        // 上一阶段结果
        const prevResults = this.getPreviousPhaseResults(ctx);
        if (prevResults) {
            parts.push(`## 前序阶段成果\n${prevResults}`);
        }
        return parts.join("\n\n");
    }
    /**
     * 获取前序阶段的结果摘要
     */
    getPreviousPhaseResults(ctx) {
        if (ctx.executionHistory.length === 0) {
            return undefined;
        }
        const parts = [];
        for (const phaseId of ctx.executionHistory) {
            const result = ctx.phaseResults.get(phaseId);
            if (result && result.status === PhaseStatus.COMPLETED) {
                const label = this.getPhaseLabel(phaseId);
                if (result.artifactPath) {
                    parts.push(`### ${label}\n产物文件: ${result.artifactPath}\n\n${result.output}`);
                }
                else {
                    parts.push(`### ${label}\n${result.output}`);
                }
            }
        }
        return parts.length > 0 ? parts.join("\n\n---\n\n") : undefined;
    }
    getPhaseLabel(phaseId) {
        const labels = {
            specification: "需求分析",
            design: "架构设计",
            planning: "任务规划",
            execution: "代码执行",
            compilation_fix: "编译修复",
            summary: "总结报告",
        };
        return labels[phaseId] || phaseId;
    }
    /**
     * 获取该阶段的契约文件路径
     */
    getArtifactPath(ctx, fileName) {
        return path.join(ctx.specDir, fileName).replace(/\\/g, "/");
    }
    /**
     * 构建系统 prompt
     */
    async buildSystemPrompt(ctx) {
        // 1. 加载阶段 prompt 模板
        let template = await getEmbeddedPrompt(this.promptTemplate);
        if (!template) {
            console.warn(`[SpecAgent] Template not found: ${this.promptTemplate}, falling back to agentic_mode`);
            template = await getEmbeddedPrompt("agentic_mode");
            if (!template) {
                throw new Error("No prompt template available");
            }
        }
        // 2. 使用 PromptBuilder 替换通用占位符
        const promptBuilder = new PromptBuilder(ctx.workspacePath);
        let systemPrompt = await promptBuilder.buildPromptFromTemplate(template);
        // 3. 替换 {SKILLS} 占位符（注入当前阶段匹配的 skill 内容）
        const skillsContent = this.buildSkillsContent(ctx);
        systemPrompt = systemPrompt.replace("{SKILLS}", skillsContent);
        // 4. 替换阶段专用占位符
        const phaseContext = this.buildPhaseContext(ctx);
        systemPrompt = systemPrompt.replace("{PHASE_CONTEXT}", phaseContext);
        systemPrompt = systemPrompt.replace("{USER_QUERY}", ctx.userQuery);
        systemPrompt = systemPrompt.replace("{SPEC_DIR}", ctx.specDir);
        // 替换各阶段产物文件路径占位符
        systemPrompt = systemPrompt.replace("{SPEC_FILE_PATH}", this.getArtifactPath(ctx, "requirements.md"));
        systemPrompt = systemPrompt.replace("{DESIGN_FILE_PATH}", this.getArtifactPath(ctx, "design.md"));
        systemPrompt = systemPrompt.replace("{PLANNING_FILE_PATH}", this.getArtifactPath(ctx, "planning.md"));
        systemPrompt = systemPrompt.replace("{EXECUTION_FILE_PATH}", this.getArtifactPath(ctx, "execution_report.md"));
        systemPrompt = systemPrompt.replace("{SUMMARY_FILE_PATH}", this.getArtifactPath(ctx, "summary.md"));
        return systemPrompt;
    }
    /**
     * 构建当前阶段适用的 skills 内容，用于替换 {SKILLS} 占位符
     */
    buildSkillsContent(ctx) {
        if (!ctx.selectedSkills || ctx.selectedSkills.length === 0) {
            return "";
        }
        const applicable = ctx.selectedSkills.filter((s) => s.appliesTo.includes(this.phaseId));
        if (applicable.length === 0) {
            return "";
        }
        const parts = applicable.map((s) => `### Skill: ${s.name}\n${s.content}`);
        return `# Reference Skills\n\nThe following skills have been selected as references for this phase. Follow their guidance when generating documents.\n\n${parts.join("\n\n---\n\n")}\n`;
    }
    /**
     * 核心方法：运行 AI 多轮 ReAct 循环（复用 RoundExecutor）
     * 从 execute() 中抽取出来，供子类在需要时单独调用
     */
    async runAgentLoop(ctx, sendEvent, systemPrompt, options = {}) {
        const userPrompt = options.userPrompt ?? ctx.userQuery;
        const maxRounds = options.maxRounds ?? 100;
        const loopDetector = new LoopDetector(this.getLoopDetectorConfig());
        const attachPhaseIdToEvent = options.attachPhaseIdToEvent ?? true;
        const toolResultNullLogPrefix = options.toolResultNullLogPrefix ?? "";
        // 构建消息
        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ];
        console.info(`[SpecWorkflowAgent] [${this.phaseId}] messages:${JSON.stringify(messages, null, 2)}`);
        // 创建 phaseId 感知的事件发送器
        const phaseEventEmitter = (eventData) => {
            sendEvent({
                event: eventData.event,
                payload: attachPhaseIdToEvent
                    ? { ...eventData.payload, phaseId: this.phaseId }
                    : eventData.payload,
            });
        };
        let allText = "";
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let lastLoopWarning;
        for (let roundNumber = 0; roundNumber < maxRounds; roundNumber += 1) {
            // 检查取消
            if (ctx.signal?.aborted) {
                throw new Error("Workflow cancelled");
            }
            const roundContext = {
                session_id: ctx.sessionId,
                turn_id: ctx.turnId, // 使用工作流级别的 turnId，与前端 dialogTurnId 一致
                round_number: roundNumber,
                workspace_path: ctx.workspacePath,
                signal: ctx.signal,
                allowed_tool_names: this.resolveAllowedToolNames(options.allowedToolNames),
            };
            const result = await this.roundExecutor.execute_round(this.modelConfig, messages, roundContext, phaseEventEmitter);
            // 累积文本和 token
            allText += result.text;
            if (result.usage) {
                totalInputTokens += result.usage.input_tokens;
                totalOutputTokens += result.usage.output_tokens;
            }
            // 将 AI 响应添加到消息历史
            if (result.text || result.tool_calls.length > 0) {
                messages.push({
                    role: "assistant",
                    content: result.text || "",
                    tool_calls: result.tool_calls.length > 0 ? result.tool_calls : undefined,
                });
            }
            // 将工具结果添加到消息历史
            if (result.tool_results.length > 0) {
                for (const toolResult of result.tool_results) {
                    if (!toolResult) {
                        console.warn(`[SpecWorkflowAgent] [${this.phaseId}] ⚠️ ${toolResultNullLogPrefix}toolResult is undefined/null, index in tool_results, skipping. tool_results:`, JSON.stringify(result.tool_results));
                        continue;
                    }
                    messages.push(this.toolResultToMessage(toolResult));
                }
            }
            console.info(`[SpecWorkflowAgent] [${this.phaseId}] messages:${JSON.stringify(messages, null, 2)}`);
            const warning = this.recordLoopState(loopDetector, roundNumber + 1, result, this.phaseId);
            const terminate = loopDetector.shouldTerminate();
            if (terminate.stop) {
                console.warn(`[SpecWorkflowAgent] [${this.phaseId}] loop terminated: ${terminate.reason || "unknown"}`);
                break;
            }
            if (!result.should_continue) {
                break;
            }
            if (warning && warning !== lastLoopWarning) {
                messages.push({
                    role: "user",
                    content: [
                        "Loop detector warning:",
                        warning,
                        "",
                        "Please adjust your strategy and avoid repeating the same ineffective actions.",
                    ].join("\n"),
                });
            }
            lastLoopWarning = warning;
        }
        return { text: allText, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
    }
    async execute(ctx, sendEvent) {
        const startTime = Date.now();
        console.info(`[SpecWorkflowAgent] [${this.phaseId}] execute`);
        try {
            const systemPrompt = await this.buildSystemPrompt(ctx);
            const { text, inputTokens, outputTokens } = await this.runAgentLoop(ctx, sendEvent, systemPrompt);
            console.info(`[SpecWorkflowAgent] [${this.phaseId}] text:${text}`);
            return {
                phaseId: this.phaseId,
                status: PhaseStatus.COMPLETED,
                output: text,
                artifactPath: this.getArtifactPath(ctx, this.getArtifactFileName()),
                tokenUsage: { input: inputTokens, output: outputTokens },
                startTime,
                endTime: Date.now(),
            };
        }
        catch (error) {
            console.error(`[SpecWorkflowAgent] [${this.phaseId}] ❌ 阶段执行失败:`, error instanceof Error ? error.stack : error);
            return {
                phaseId: this.phaseId,
                status: PhaseStatus.FAILED,
                output: error instanceof Error ? error.message : String(error),
                tokenUsage: { input: 0, output: 0 },
                startTime,
                endTime: Date.now(),
            };
        }
    }
    /**
     * 阶段完成后的反馈对话
     * 基于当前阶段的上下文和产出，与用户进行连续对话（不重跑阶段）
     */
    async handleFeedback(ctx, sendEvent, phaseResult, feedbackMessage, feedbackHistory) {
        console.info(`[SpecWorkflowAgent] [${this.phaseId}] handleFeedback: "${feedbackMessage.slice(0, 100)}"`);
        // 1. 构建系统 prompt（与阶段执行相同的上下文）
        const systemPrompt = await this.buildSystemPrompt(ctx);
        // 2. 构建消息序列：system → 原始 user query → assistant 阶段产出 → 历史反馈 → 新反馈
        const feedbackContext = [
            "## 当前阶段已有产出",
            phaseResult.output || "(空)",
            "",
            "## 历史反馈对话",
            feedbackHistory
                .map((item, index) => `${index + 1}. ${item.role}: ${item.content}`)
                .join("\n") || "(无)",
            "",
            "## 用户最新反馈",
            feedbackMessage,
            "",
            "请基于以上信息继续回答，并保持与当前阶段目标一致。",
        ].join("\n");
        // 4. 执行单轮/多轮对话（复用 RoundExecutor）
        const { text } = await this.runAgentLoop(ctx, sendEvent, systemPrompt, {
            userPrompt: feedbackContext,
            maxRounds: 20,
            toolResultNullLogPrefix: "feedback ",
        });
        return text;
    }
    toolResultToMessage(toolResult) {
        return {
            role: "tool",
            content: toolResult.result_for_assistant || JSON.stringify(toolResult.result),
            tool_call_id: toolResult.tool_id,
            name: toolResult.tool_name,
        };
    }
    recordLoopState(detector, roundNumber, result, phaseLabel) {
        const validResults = result.tool_results.filter((item) => item != null);
        const resultById = new Map(validResults.map((item) => [item.tool_id, item]));
        for (const call of result.tool_calls) {
            const output = resultById.get(call.tool_id);
            if (!output) {
                console.warn(`[SpecWorkflowAgent] [${phaseLabel}] missing tool result for tool_id=${call.tool_id}, tool_name=${call.tool_name}, skipping loop record`);
                continue;
            }
            detector.recordToolCall(call.tool_name, call.arguments || {}, output.result_for_assistant || output.result || "", !output.is_error, roundNumber);
        }
        const warning = detector.getWarningMessage();
        if (warning) {
            console.warn(`[SpecWorkflowAgent] [${phaseLabel}] loop warning: ${warning}`);
        }
        return warning;
    }
    /**
     * 解析当前回合允许的工具集
     */
    resolveAllowedToolNames(overrideAllowed) {
        if (overrideAllowed && overrideAllowed.length > 0) {
            return overrideAllowed;
        }
        const explicit = this.getAllowedToolNames();
        if (explicit && explicit.length > 0) {
            return explicit;
        }
        const excluded = this.getExcludedToolNames();
        if (excluded.length === 0) {
            return undefined;
        }
        return getAllToolDefinitions()
            .map((def) => def.name)
            .filter((toolName) => !excluded.includes(toolName));
    }
}
//# sourceMappingURL=base_agent.js.map