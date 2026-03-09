import fs from "node:fs/promises";
import path from "node:path";
import { SpecWorkflowAgent } from "../../agents/base_agent.js";
import { FixTaskType } from "../core/models.js";
import { ErrorClassifier } from "../core/classifier.js";
import { DEFAULT_COMPILATION_FIX_CONFIG } from "../config.js";
import { runCompilationCheck } from "./compile_service.js";
import { TaskEventEmitter } from "./task_event_emitter.js";
class CompilationFixTaskAgent extends SpecWorkflowAgent {
    logger;
    phaseId = "compilation_fix";
    phaseName = "编译修复任务";
    promptTemplate = "spec_execution";
    constructor(logger) {
        super();
        this.logger = logger;
    }
    getArtifactFileName() {
        return "compilation_fix_report.md";
    }
    /** 编译修复不限制工具，返回 undefined 表示允许使用所有已注册工具 */
    getAllowedToolNames() {
        return undefined;
    }
    recordLoopState(detector, roundNumber, result, phaseLabel) {
        const warning = super.recordLoopState(detector, roundNumber, result, phaseLabel);
        if (result.tool_calls.length > 0) {
            this.logger(`[TaskAgent] round=${roundNumber} tools=${result.tool_calls.map((item) => item.tool_name).join(", ")}`);
        }
        return warning;
    }
    async runTaskLoop(taskContext, systemPrompt, userPrompt, emitEvent, maxRounds) {
        await this.runAgentLoop(taskContext, emitEvent, systemPrompt, {
            userPrompt,
            maxRounds,
            attachPhaseIdToEvent: false,
        });
    }
}
export class ToolRuntime {
    context;
    resolvedModel = null;
    classifier = new ErrorClassifier(DEFAULT_COMPILATION_FIX_CONFIG);
    taskReminder = [
        "IMPORTANT: Fix ONLY the specified compilation errors in this task.",
        "Do NOT fix unrelated errors.",
        "Prefer minimal and safe edits.",
        "After edits, call HmosCompilation to verify.",
    ].join(" ");
    constructor(context) {
        this.context = context;
    }
    async compile(project_abs_path, _signal) {
        return runCompilationCheck(project_abs_path, this.context);
    }
    async run_fix_task(project_abs_path, task, round_num, timeout_sec, signal, batch_index = 1, total_batches = 1) {
        const taskEmitter = new TaskEventEmitter(task.task_id, this.context.emit_event || (() => { }), {
            sessionId: this.context.session_id,
            turnId: this.context.turn_id,
            phaseId: "compilation_fix",
            roundNum: round_num,
            batchIndex: batch_index,
            totalBatches: total_batches,
        });
        const startTime = Date.now();
        const total = this.extractTaskErrors(task).length;
        const initialErrorCount = this.countTaskErrors(task);
        taskEmitter.emitTaskStarted({
            taskType: task.task_type,
            taskName: `${task.task_type}:${task.task_id}`,
            description: this.buildTaskDescription(task),
            errorCount: initialErrorCount,
            affectedFiles: task.affected_files ? Array.from(task.affected_files) : undefined,
        });
        taskEmitter.emitTaskStatus({
            status: "running",
            progress: 0,
            message: "task started",
        });
        this.log(`[Task ${task.task_id}] 开始执行，round=${round_num}, timeout=${timeout_sec}s`);
        const model = await this.resolveModelConfig();
        if (!model) {
            this.log(`[Task ${task.task_id}] 未找到可用模型配置，终止`);
            taskEmitter.emitTaskStatus({
                status: "failed",
                message: "No available AI model config",
            });
            taskEmitter.emitTaskCompleted({
                taskType: task.task_type,
                success: false,
                fixedCount: 0,
                remainingCount: initialErrorCount,
                durationMs: Date.now() - startTime,
                errorMessage: "No available AI model config",
            });
            return {
                task_id: task.task_id,
                task_type: task.task_type,
                success: false,
                fixed_count: 0,
                error_message: "No available AI model config",
            };
        }
        this.log(`[Task ${task.task_id}] 使用模型: ${model.id}/${model.model_name}`);
        const beforeCompile = await this.compile(project_abs_path, signal);
        const beforeTargetRemaining = this.countTaskRemainingErrors(task, beforeCompile.errors_text);
        this.log(`[Task ${task.task_id}] 执行前目标错误数: ${beforeTargetRemaining}/${total}`);
        try {
            await this.runTaskLoop(model, project_abs_path, task, round_num, timeout_sec, taskEmitter.wrapAgenticEmitter(), signal);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`[Task ${task.task_id}] 执行异常: ${message}`);
            taskEmitter.emitTaskStatus({
                status: "failed",
                message,
            });
            taskEmitter.emitTaskCompleted({
                taskType: task.task_type,
                success: false,
                fixedCount: 0,
                remainingCount: beforeTargetRemaining,
                durationMs: Date.now() - startTime,
                errorMessage: message,
            });
            return {
                task_id: task.task_id,
                task_type: task.task_type,
                success: false,
                fixed_count: 0,
                error_message: message,
            };
        }
        const afterCompile = await this.compile(project_abs_path, signal);
        const afterTargetRemaining = this.countTaskRemainingErrors(task, afterCompile.errors_text);
        const fixed = Math.max(0, beforeTargetRemaining - afterTargetRemaining);
        this.log(`[Task ${task.task_id}] 执行完成，修复 ${Math.min(fixed, total)} 个，剩余 ${afterTargetRemaining} 个`);
        taskEmitter.emitTaskStatus({
            status: "completed",
            progress: 100,
            message: "task completed",
        });
        taskEmitter.emitTaskCompleted({
            taskType: task.task_type,
            success: fixed >= 0,
            fixedCount: Math.min(fixed, total),
            remainingCount: Math.max(0, afterTargetRemaining),
            durationMs: Date.now() - startTime,
        });
        return {
            task_id: task.task_id,
            task_type: task.task_type,
            success: true,
            fixed_count: Math.min(fixed, total),
        };
    }
    log(message) {
        console.info(`[CompilationFixRuntime] ${message}`);
    }
    report_progress(message, progress) {
        if (progress === undefined) {
            console.info(`[CompilationFixRuntime] ${message}`);
            return;
        }
        console.info(`[CompilationFixRuntime] ${message} (${Math.round(progress)}%)`);
    }
    emit_main_chat_round_started(roundId, roundIndex = 0, order) {
        this.context.emit_event?.({
            event: "agentic://model-round-started",
            payload: {
                sessionId: this.context.session_id,
                turnId: this.context.turn_id,
                roundId,
                roundIndex,
                phaseId: "compilation_fix",
                compilationFixMainChat: true,
                compilationFixOrder: order,
            },
        });
    }
    emit_main_chat_text(roundId, text, contentType = "text") {
        this.context.emit_event?.({
            event: "agentic://text-chunk",
            payload: {
                sessionId: this.context.session_id,
                turnId: this.context.turn_id,
                roundId,
                text,
                contentType,
                phaseId: "compilation_fix",
                compilationFixMainChat: true,
            },
        });
    }
    emit_main_chat_tool_event(roundId, toolEvent) {
        this.context.emit_event?.({
            event: "agentic://tool-event",
            payload: {
                sessionId: this.context.session_id,
                turnId: this.context.turn_id,
                roundId,
                phaseId: "compilation_fix",
                compilationFixMainChat: true,
                toolEvent,
            },
        });
    }
    emit_main_chat_panel_marker(roundNum, anchorRoundId, order) {
        const markerRoundId = `cf-panel-marker-${roundNum}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.context.emit_event?.({
            event: "agentic://model-round-started",
            payload: {
                sessionId: this.context.session_id,
                turnId: this.context.turn_id,
                roundId: markerRoundId,
                roundIndex: 0,
                phaseId: "compilation_fix",
                compilationFixMainChat: true,
                compilationFixOrder: order,
                compilationFixMarker: {
                    kind: "panel_round",
                    roundNum,
                    emittedAt: Date.now(),
                    anchorRoundId,
                },
            },
        });
    }
    async runTaskLoop(model, project_abs_path, task, roundNum, timeoutSec, emitEvent, signal) {
        const userPrompt = this.buildTaskPrompt(task, project_abs_path);
        const systemPrompt = [
            "You are an ArkTS compilation fix agent.",
            "Only fix errors listed in user prompt.",
            "Prefer minimal and safe edits.",
            "After code edits, always call HmosCompilation to verify.",
        ].join(" ");
        const maxRounds = 20;
        const taskAbortController = new AbortController();
        const abortTask = (reason) => {
            if (!taskAbortController.signal.aborted) {
                taskAbortController.abort(new Error(reason));
            }
        };
        const parentAbortHandler = () => abortTask("task aborted");
        signal?.addEventListener("abort", parentAbortHandler, { once: true });
        const taskContext = {
            sessionId: this.context.session_id,
            turnId: this.context.turn_id,
            userQuery: userPrompt,
            workspacePath: this.context.workspace_path || project_abs_path,
            phaseResults: new Map(),
            executionHistory: [],
            specDir: this.context.workspace_path || project_abs_path,
            signal: taskAbortController.signal,
            feedbackHistory: new Map(),
            selectedSkills: [],
        };
        const taskAgent = new CompilationFixTaskAgent((message) => {
            this.log(`[Task ${task.task_id}] ${message}`);
        });
        taskAgent.modelConfig = model;
        const timeoutMessage = `task timeout (${timeoutSec}s)`;
        let timeoutReject;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutReject = reject;
        });
        const timeoutId = setTimeout(() => {
            abortTask(timeoutMessage);
            timeoutReject?.(new Error(timeoutMessage));
        }, timeoutSec * 1000);
        const taskAbortHandler = () => {
            clearTimeout(timeoutId);
            const reason = taskAbortController.signal.reason;
            timeoutReject?.(reason instanceof Error ? reason : new Error("task aborted"));
        };
        taskAbortController.signal.addEventListener("abort", taskAbortHandler, { once: true });
        this.log(`[Task ${task.task_id}] 启动 Agent 任务循环，maxRounds=${maxRounds}, round=${roundNum}`);
        const taskLoopPromise = taskAgent.runTaskLoop(taskContext, systemPrompt, userPrompt, emitEvent, maxRounds);
        void taskLoopPromise.catch(() => { });
        try {
            await Promise.race([taskLoopPromise, timeoutPromise]);
            this.log(`[Task ${task.task_id}] Agent 任务循环完成`);
        }
        finally {
            clearTimeout(timeoutId);
            taskAbortController.signal.removeEventListener("abort", taskAbortHandler);
            signal?.removeEventListener("abort", parentAbortHandler);
        }
    }
    countTaskErrors(task) {
        return this.extractTaskErrors(task).length;
    }
    buildTaskDescription(task) {
        const count = this.countTaskErrors(task);
        if (task.task_type === FixTaskType.FILE_GROUP) {
            return `Fix ${count} file-group compilation errors for task ${task.task_id}`;
        }
        return `Fix ${count} code-group compilation errors for task ${task.task_id}`;
    }
    buildTaskPrompt(task, project_abs_path) {
        if (task.task_type === FixTaskType.FILE_GROUP) {
            const payload = task.payload;
            this.log(`[Task ${task.task_id}] 构建 file_group prompt，分类数=${payload.length}`);
            const sections = payload.map((category, idx) => {
                const errors = category.errors
                    .map((err) => `- code=${err.error_code}, line=${err.line}, column=${err.column}, message=${err.message_details}`)
                    .join("\n");
                return `${idx + 1}. file=${category.error_file_path}, count=${category.count}\n${errors}`;
            });
            return [
                `Project path: ${project_abs_path}`,
                `Task id: ${task.task_id} (file_group)`,
                "Fix ONLY the following file-group compilation errors:",
                sections.join("\n\n"),
                this.taskReminder,
            ].join("\n");
        }
        const payload = task.payload;
        this.log(`[Task ${task.task_id}] 构建 code_group prompt，分类数=${payload.length}`);
        const sections = payload.map((category, idx) => {
            const errors = category.errors
                .map((err) => `- file=${err.file}, line=${err.line}, column=${err.column}, message=${err.message_details}`)
                .join("\n");
            return `${idx + 1}. code=${category.error_code}, count=${category.count}\n${errors}`;
        });
        return [
            `Project path: ${project_abs_path}`,
            `Task id: ${task.task_id} (code_group)`,
            "Fix ONLY the following code-group compilation errors:",
            sections.join("\n\n"),
            this.taskReminder,
        ].join("\n");
    }
    async resolveModelConfig() {
        if (this.context.model_config) {
            return this.context.model_config;
        }
        if (this.resolvedModel) {
            this.log(`使用缓存模型配置: ${this.resolvedModel.id}/${this.resolvedModel.model_name}`);
            return this.resolvedModel;
        }
        const workspace = this.context.workspace_path || process.cwd();
        const configPath = path.join(workspace, ".vcoder_ts", "config.json");
        try {
            const raw = await fs.readFile(configPath, "utf8");
            const data = JSON.parse(raw);
            const values = data.values || {};
            const ai = values.ai || {};
            const modelListRaw = Array.isArray(ai.models)
                ? ai.models
                : Array.isArray(data.modelConfigs)
                    ? data.modelConfigs
                    : [];
            const enabledModels = modelListRaw.filter((item) => item.enabled !== false);
            const modelPool = enabledModels.length > 0 ? enabledModels : modelListRaw;
            if (modelPool.length > 0) {
                const defaults = ai.default_models || {};
                const primary = typeof defaults.primary === "string" ? defaults.primary : null;
                if (primary) {
                    const selected = modelPool.find((item) => item.id === primary);
                    if (selected) {
                        this.resolvedModel = selected;
                        this.log(`从配置 primary 命中模型: ${selected.id}/${selected.model_name}`);
                        return selected;
                    }
                }
                this.resolvedModel = modelPool[0];
                this.log(`从配置选择首个可用模型: ${modelPool[0].id}/${modelPool[0].model_name}`);
                return modelPool[0];
            }
        }
        catch (error) {
            this.log(`读取模型配置失败，回退环境变量模型: ${error instanceof Error ? error.message : String(error)}`);
            // ignore file parse errors and fallback to env model
        }
        const envApiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.VCODER_API_KEY;
        const fallback = {
            id: "deepseek-chat",
            name: "DeepSeek Chat",
            provider: "openai",
            model_name: "deepseek-chat",
            base_url: "https://api.deepseek.com/v1",
            api_key: envApiKey,
            enabled: true,
        };
        this.resolvedModel = fallback;
        this.log(`使用环境变量回退模型: ${fallback.id}/${fallback.model_name}`);
        return fallback;
    }
    extractTaskErrors(task) {
        if (task.task_type === FixTaskType.FILE_GROUP) {
            return task.payload.flatMap((category) => category.errors);
        }
        return task.payload.flatMap((category) => category.errors);
    }
    countTaskRemainingErrors(task, errorsText) {
        const targets = this.extractTaskErrors(task);
        if (targets.length === 0) {
            return 0;
        }
        const remaining = this.classifier.parseErrors(errorsText);
        if (remaining.length === 0) {
            return 0;
        }
        const remainingExact = new Set(remaining.map((item) => `${item.error_code}|${this.normalizeFilePath(item.file)}|${item.line}|${item.column}`));
        const remainingFuzzy = new Set(remaining.map((item) => `${item.error_code}|${this.normalizeFilePath(item.file)}|${this.normalizeMessage(item.message_details)}`));
        let unresolved = 0;
        for (const item of targets) {
            const exactKey = `${item.error_code}|${this.normalizeFilePath(item.file)}|${item.line}|${item.column}`;
            if (remainingExact.has(exactKey)) {
                unresolved += 1;
                continue;
            }
            const fuzzyKey = `${item.error_code}|${this.normalizeFilePath(item.file)}|${this.normalizeMessage(item.message_details)}`;
            if (remainingFuzzy.has(fuzzyKey)) {
                unresolved += 1;
            }
        }
        return unresolved;
    }
    normalizeMessage(message) {
        return message
            .replace(/'[^']*'/g, "'x'")
            .replace(/"[^"]*"/g, '"x"')
            .replace(/\b\d+\b/g, "#")
            .trim();
    }
    normalizeFilePath(filePath) {
        return filePath.replace(/\\/g, "/").trim().toLowerCase();
    }
}
//# sourceMappingURL=tool_runtime.js.map