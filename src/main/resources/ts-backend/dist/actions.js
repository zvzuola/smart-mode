import { deleteByPath, extractRequestBody, genId, getByPath, nowMs, nowSec, pickParam, requireParam, setByPath, } from "./utils.js";
import { RoundExecutor } from "./execution/round_executor.js";
import { buildSystemPrompt } from "./prompt/index.js";
import { getGlobalToolRegistry } from "./tools/registry.js";
import { SpecWorkflowExecutor } from "./spec-workflow/index.js";
import { loadWorkflowState, deleteWorkflowState } from "./spec-workflow/persistence.js";
import { saveDialogTurnToFile, loadDialogTurns, deleteDialogTurns, saveCompilationFixSnapshot, loadCompilationFixSnapshot, } from "./spec-workflow/dialog_turn_persistence.js";
import path from "node:path";
import fs from "node:fs";
import { setGlobalWorkspacePath, getGlobalWorkspacePath } from "./context/workspace.js";
import { setUserDevecoHome, findDevecoHome } from "./tools/implementations/deveco_resolver.js";
function ok(success = true) {
    return { success };
}
function toSessionInfo(session) {
    return {
        sessionId: session.sessionId,
        sessionName: session.sessionName,
        agentType: session.agentType,
        state: session.state,
        turnCount: session.turnCount,
        createdAt: session.createdAt,
    };
}
function truncate(input, maxLength) {
    if (input.length <= maxLength) {
        return input;
    }
    return `${input.slice(0, maxLength).trim()}...`;
}
function splitChunks(text, chunkSize = 80) {
    if (text.length <= chunkSize) {
        return [text];
    }
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
}
/**
 * Spec 模式：运行 5 阶段工作流
 */
async function runSpecWorkflow(ctx, sendEvent, session, turnId, userInput, signal) {
    console.info(`[COVERAGE][actions] runSpecWorkflow() 入口 | sessionId=${session.sessionId}, turnId=${turnId}, userInputLen=${userInput.length}, workspacePath=${session.workspacePath}`);
    session.state = "processing";
    await ctx.saveSession(session);
    sendEvent({
        event: "agentic://session-state-changed",
        payload: { sessionId: session.sessionId, newState: "processing" },
    });
    sendEvent({
        event: "agentic://dialog-turn-started",
        payload: { sessionId: session.sessionId, turnId },
    });
    try {
        const modelConfig = ctx.findModelConfig("spec_workflow");
        if (!modelConfig) {
            console.error(`[COVERAGE][actions] 模型配置未找到 | configName=spec_workflow`);
            throw new Error("Spec 模式的模型配置未找到");
        }
        console.info(`[COVERAGE][actions] 模型配置已找到 | provider=${modelConfig.provider}, model=${modelConfig.model_name}`);
        const workspacePath = session.workspacePath || process.cwd();
        // 创建工作流执行器（接收 AppContext）
        const executor = new SpecWorkflowExecutor(session.sessionId, turnId, userInput, workspacePath, modelConfig, signal);
        // 注册到 AppContext 上的 workflowRouter
        ctx.workflowRouter.register(session.sessionId, executor);
        // 启动工作流（异步执行，阶段之间会等待用户操作）
        console.info(`[COVERAGE][actions] 启动工作流 | sessionId=${session.sessionId}`);
        await executor.start(sendEvent);
        // 工作流完成，保存结果
        console.info(`[COVERAGE][actions] 工作流正常完成 | sessionId=${session.sessionId}`);
        const assistantMsg = {
            id: genId("m"),
            role: "assistant",
            content: "Spec 工作流已完成。",
            timestamp: nowMs(),
        };
        session.messages.push(assistantMsg);
        const turn = {
            turnId,
            userInput,
            assistantOutput: "Spec 工作流已完成。",
            createdAt: nowMs(),
            files: [],
        };
        session.turns.push(turn);
        session.turnCount = session.turns.length;
        session.state = "idle";
        await ctx.saveSession(session);
        sendEvent({
            event: "agentic://dialog-turn-completed",
            payload: { sessionId: session.sessionId, turnId },
        });
        sendEvent({
            event: "agentic://session-state-changed",
            payload: { sessionId: session.sessionId, newState: "idle" },
        });
    }
    catch (error) {
        const isAbort = error.name === "AbortError";
        console.error(`[COVERAGE][actions] runSpecWorkflow catch | sessionId=${session.sessionId}, isAbort=${isAbort}, errorType=${error instanceof Error ? error.constructor.name : typeof error}, error=${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : '');
        session.state = "idle";
        await ctx.saveSession(session);
        if (isAbort) {
            console.info(`[COVERAGE][actions] 工作流被取消(AbortError) | sessionId=${session.sessionId}`);
            sendEvent({
                event: "agentic://dialog-turn-cancelled",
                payload: { sessionId: session.sessionId, turnId },
            });
        }
        else {
            console.error(`[COVERAGE][actions] 工作流执行失败 | sessionId=${session.sessionId}, error=${error instanceof Error ? error.message : String(error)}`);
            sendEvent({
                event: "agentic://dialog-turn-failed",
                payload: {
                    sessionId: session.sessionId,
                    turnId,
                    error: error instanceof Error ? error.message : String(error),
                },
            });
        }
        sendEvent({
            event: "agentic://session-state-changed",
            payload: { sessionId: session.sessionId, newState: "idle" },
        });
    }
    finally {
        console.info(`[COVERAGE][actions] runSpecWorkflow finally | sessionId=${session.sessionId}, turnId=${turnId}`);
        ctx.endTurn(session.sessionId, turnId);
        ctx.workflowRouter.unregister(session.sessionId);
    }
}
async function runDialogTurn(ctx, sendEvent, session, turnId, userInput, agentType, signal) {
    session.state = "processing";
    await ctx.saveSession(session);
    sendEvent({
        event: "agentic://session-state-changed",
        payload: { sessionId: session.sessionId, newState: "processing" },
    });
    sendEvent({
        event: "agentic://dialog-turn-started",
        payload: { sessionId: session.sessionId, turnId },
    });
    try {
        const executor = new RoundExecutor();
        const modelConfig = ctx.findModelConfig(agentType);
        if (!modelConfig) {
            throw new Error(`模型配置未找到: ${agentType}`);
        }
        // 构建系统提示词（对标Rust版本）
        const workspacePath = session.workspacePath || process.cwd();
        const systemPrompt = await buildSystemPrompt(workspacePath, "agentic_mode");
        // 构建消息历史（系统提示词 + 历史消息 + 当前用户输入）
        const messages = [
            // 1. 系统提示词（始终在第一条）
            {
                role: "system",
                content: systemPrompt,
            },
            // 2. 历史消息（排除旧的system消息，取最近12条）
            ...session.messages
                .filter((m) => m.role === "user" || m.role === "assistant")
                .slice(-12)
                .map((m) => ({
                role: m.role,
                content: m.content,
            })),
        ];
        // 3. 添加当前用户输入
        messages.push({
            role: "user",
            content: userInput,
        });
        // 执行多轮对话（最多 200 轮，与 Rust 版本对齐）
        let round_number = 0;
        let all_text = "";
        let total_input_tokens = 0;
        let total_output_tokens = 0;
        const max_rounds = 200;
        while (round_number < max_rounds) {
            const context = {
                session_id: session.sessionId,
                turn_id: turnId,
                turn_index: session.turnCount, // 添加turn索引（用于快照系统）
                round_number,
                workspace_path: session.workspacePath,
                signal,
            };
            const result = await executor.execute_round(modelConfig, messages, context, sendEvent);
            // 累积文本和 token
            all_text += result.text;
            if (result.usage) {
                total_input_tokens += result.usage.input_tokens;
                total_output_tokens += result.usage.output_tokens;
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
                for (const tool_result of result.tool_results) {
                    messages.push({
                        role: "tool",
                        content: tool_result.result_for_assistant || JSON.stringify(tool_result.result),
                        tool_call_id: tool_result.tool_id,
                        name: tool_result.tool_name,
                    });
                }
            }
            round_number++;
            // 如果不需要继续，退出循环
            if (!result.should_continue) {
                break;
            }
        }
        // 保存最终结果
        const assistantMsg = {
            id: genId("m"),
            role: "assistant",
            content: all_text || "已完成处理。",
            timestamp: nowMs(),
        };
        session.messages.push(assistantMsg);
        const turn = {
            turnId,
            userInput,
            assistantOutput: all_text || "已完成处理。",
            createdAt: nowMs(),
            files: [],
        };
        session.turns.push(turn);
        session.turnCount = session.turns.length;
        session.state = "idle";
        await ctx.saveSession(session);
        // 保存turn上下文快照（对标Rust版本）
        const turnIndex = session.turnCount - 1;
        await ctx.saveTurnSnapshot(session.sessionId, turnIndex, session.messages);
        // 发送 token 使用统计
        sendEvent({
            event: "agentic://token-usage-updated",
            payload: {
                sessionId: session.sessionId,
                turnId,
                inputTokens: total_input_tokens,
                outputTokens: total_output_tokens,
                totalTokens: total_input_tokens + total_output_tokens,
            },
        });
        sendEvent({
            event: "agentic://dialog-turn-completed",
            payload: {
                sessionId: session.sessionId,
                turnId,
            },
        });
        sendEvent({
            event: "agentic://session-state-changed",
            payload: { sessionId: session.sessionId, newState: "idle" },
        });
    }
    catch (error) {
        const isAbort = error.name === "AbortError";
        session.state = "idle";
        await ctx.saveSession(session);
        if (isAbort) {
            sendEvent({
                event: "agentic://dialog-turn-cancelled",
                payload: {
                    sessionId: session.sessionId,
                    turnId,
                },
            });
        }
        else {
            sendEvent({
                event: "agentic://dialog-turn-failed",
                payload: {
                    sessionId: session.sessionId,
                    turnId,
                    error: error instanceof Error ? error.message : String(error),
                },
            });
            sendEvent({
                event: "agentic://error",
                payload: {
                    sessionId: session.sessionId,
                    error: error instanceof Error ? error.message : String(error),
                },
            });
        }
        sendEvent({
            event: "agentic://session-state-changed",
            payload: { sessionId: session.sessionId, newState: "idle" },
        });
    }
    finally {
        ctx.endTurn(session.sessionId, turnId);
    }
}
export async function handleAction(request, ctx, sendEvent) {
    const action = request.action;
    const body = extractRequestBody(request.params);
    const cfg = ctx.getConfigState();
    switch (action) {
        case "ping":
            return { pong: true, timestamp: nowSec() };
        case "create_session": {
            const sessionId = (pickParam(body, ["sessionId", "session_id"]) ?? genId("s")).toString();
            const sessionName = (pickParam(body, ["sessionName", "session_name"]) ?? "New Session").toString();
            const agentType = (pickParam(body, ["agentType", "agent_type", "mode"]) ?? "agentic").toString();
            const workspacePath = pickParam(body, ["workspacePath", "workspace_path"]);
            const existing = ctx.getSession(sessionId);
            if (existing) {
                return {
                    sessionId: existing.sessionId,
                    sessionName: existing.sessionName,
                    agentType: existing.agentType,
                };
            }
            const resolvedWorkspace = workspacePath?.toString() ?? getGlobalWorkspacePath() ?? ctx.workspacePath;
            console.log(`[actions] create_session workspace: client=${workspacePath}, global=${getGlobalWorkspacePath()}, ctx=${ctx.workspacePath}, resolved=${resolvedWorkspace}`);
            const session = {
                sessionId,
                sessionName,
                agentType,
                state: "idle",
                turnCount: 0,
                createdAt: nowMs(),
                // 优先级：客户端传入 > globalWorkspacePath（open_workspace设置） > AppContext启动参数
                workspacePath: resolvedWorkspace,
                messages: [],
                turns: [],
            };
            await ctx.saveSession(session);
            return { sessionId, sessionName, agentType };
        }
        case "start_dialog_turn": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const userInput = requireParam(body, ["userInput", "message"], "userInput").toString();
            const workspacePathFromClient = pickParam(body, ["workspacePath", "workspace_path"]);
            let session = ctx.getSession(sessionId);
            if (!session) {
                const agentType = (pickParam(body, ["agentType", "agent_type", "mode"]) ?? "HarmonyOSDev").toString();
                const sessionName = (pickParam(body, ["sessionName", "session_name"]) ?? `Session ${sessionId.slice(0, 8)}`).toString();
                session = {
                    sessionId,
                    sessionName,
                    agentType,
                    state: "idle",
                    turnCount: 0,
                    createdAt: nowMs(),
                    // 优先级：客户端传入 > globalWorkspacePath（open_workspace设置） > AppContext启动参数
                    workspacePath: workspacePathFromClient?.toString() ?? getGlobalWorkspacePath() ?? ctx.workspacePath,
                    messages: [],
                    turns: [],
                };
                await ctx.saveSession(session);
            }
            else if (workspacePathFromClient) {
                // 如果客户端传入了 workspacePath，更新已有 session 的路径
                session.workspacePath = workspacePathFromClient.toString();
                await ctx.saveSession(session);
            }
            const userMsg = {
                id: genId("m"),
                role: "user",
                content: userInput,
                timestamp: nowMs(),
            };
            session.messages.push(userMsg);
            await ctx.saveSession(session);
            const requestedTurnId = pickParam(body, ["turnId", "turn_id"]);
            const { turnId, signal } = ctx.beginTurn(sessionId, requestedTurnId?.toString());
            const agentType = (pickParam(body, ["agentType", "agent_type", "mode"]) ?? session.agentType).toString();
            // 普通对话模式（spec_workflow 走独立 RPC start_spec_workflow）
            console.log(`[actions] start_dialog_turn agentType="${agentType}", session.agentType="${session.agentType}", workspace="${session.workspacePath}"`);
            void runDialogTurn(ctx, sendEvent, session, turnId, userInput, agentType, signal);
            return { success: true, message: "started" };
        }
        case "cancel_dialog_turn": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const turnId = requireParam(body, ["dialogTurnId", "turnId", "turn_id"], "dialogTurnId").toString();
            const cancelled = ctx.cancelTurn(sessionId, turnId);
            if (!cancelled) {
                throw new Error(`Dialog turn not running: ${turnId}`);
            }
            return ok();
        }
        // ============ Spec Workflow 独立 RPC ============
        case "start_spec_workflow": {
            console.info(`[COVERAGE][actions] RPC start_spec_workflow 入口`);
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const userInput = requireParam(body, ["userInput", "message", "user_input"], "userInput").toString();
            const workspacePath = pickParam(body, ["workspacePath", "workspace_path"]);
            const requestedTurnId = pickParam(body, ["turnId", "turn_id"]);
            console.info(`[COVERAGE][actions] start_spec_workflow 参数 | sessionId=${sessionId}, userInputLen=${userInput.length}, workspacePath=${workspacePath ?? 'N/A'}, requestedTurnId=${requestedTurnId ?? 'N/A'}`);
            let session = ctx.getSession(sessionId);
            if (!session) {
                console.info(`[COVERAGE][actions] start_spec_workflow: 创建新session | sessionId=${sessionId}`);
                session = {
                    sessionId,
                    sessionName: `Spec ${sessionId.slice(0, 8)}`,
                    agentType: "spec_workflow",
                    state: "idle",
                    turnCount: 0,
                    createdAt: nowMs(),
                    // 优先级：客户端传入 > globalWorkspacePath（open_workspace设置） > AppContext启动参数
                    workspacePath: workspacePath?.toString() ?? getGlobalWorkspacePath() ?? ctx.workspacePath,
                    messages: [],
                    turns: [],
                };
                await ctx.saveSession(session);
            }
            else if (workspacePath) {
                // 如果客户端传入了 workspacePath，更新已有 session 的路径
                session.workspacePath = workspacePath.toString();
                await ctx.saveSession(session);
            }
            const userMsg = {
                id: genId("m"),
                role: "user",
                content: userInput,
                timestamp: nowMs(),
            };
            session.messages.push(userMsg);
            await ctx.saveSession(session);
            const { turnId, signal } = ctx.beginTurn(sessionId, requestedTurnId?.toString());
            console.info(`[COVERAGE][actions] start_spec_workflow: beginTurn完成 | turnId=${turnId}, hasSignal=${!!signal}`);
            void runSpecWorkflow(ctx, sendEvent, session, turnId, userInput, signal);
            return { success: true, sessionId, turnId };
        }
        case "spec_workflow_action": {
            console.info(`[COVERAGE][actions] RPC spec_workflow_action 入口`);
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const actionType = requireParam(body, ["action", "actionType", "action_type"], "action").toString();
            const payload = pickParam(body, ["payload"]);
            console.info(`[COVERAGE][actions] spec_workflow_action 参数 | sessionId=${sessionId}, actionType=${actionType}, hasPayload=${!!payload}`);
            // 解析用户操作
            let userAction;
            switch (actionType) {
                case "next_phase":
                    userAction = { type: "next_phase" };
                    break;
                case "rollback": {
                    const targetPhase = (payload?.targetPhase ?? payload?.target_phase ?? payload?.rollback_to_phase);
                    if (!targetPhase) {
                        throw new Error("targetPhase required for rollback action");
                    }
                    userAction = { type: "rollback", targetPhase: targetPhase };
                    break;
                }
                case "edit": {
                    const feedback = (payload?.feedback ?? payload?.message);
                    userAction = { type: "edit", feedback };
                    break;
                }
                case "feedback": {
                    const message = (payload?.message ?? payload?.feedback);
                    if (!message) {
                        throw new Error("message required for feedback action");
                    }
                    const feedbackTurnId = (payload?.turnId);
                    userAction = { type: "feedback", message, turnId: feedbackTurnId };
                    break;
                }
                case "abort":
                    userAction = { type: "abort" };
                    break;
                case "complete_workflow":
                    userAction = { type: "complete_workflow" };
                    break;
                default:
                    console.error(`[COVERAGE][actions] spec_workflow_action: 未知操作类型 | actionType=${actionType}`);
                    throw new Error(`Unknown workflow action: ${actionType}`);
            }
            console.info(`[COVERAGE][actions] spec_workflow_action: 解析完成 | actionType=${actionType}, userAction=${JSON.stringify(userAction).slice(0, 200)}`);
            // 路由到对应的工作流引擎
            const routed = ctx.workflowRouter.routeUserAction(sessionId, userAction);
            if (!routed) {
                console.error(`[COVERAGE][actions] spec_workflow_action: 路由失败(无活跃工作流或未在等待) | sessionId=${sessionId}, actionType=${actionType}`);
                throw new Error(`No active workflow for session: ${sessionId}`);
            }
            console.info(`[COVERAGE][actions] spec_workflow_action: 路由成功 | sessionId=${sessionId}, actionType=${actionType}`);
            return { success: true, action: actionType };
        }
        case "get_spec_workflow_status": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const executor = ctx.workflowRouter.getExecutor(sessionId);
            if (!executor) {
                return { active: false };
            }
            return {
                active: true,
                status: executor.getStatus(),
                waitingForAction: executor.isWaitingForAction(),
            };
        }
        case "cancel_spec_workflow": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const executor = ctx.workflowRouter.getExecutor(sessionId);
            if (!executor) {
                throw new Error(`No active workflow for session: ${sessionId}`);
            }
            // 发送 abort 操作
            executor.handleUserAction({ type: "abort" });
            return ok();
        }
        case "get_spec_workflow_phases": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const executor = ctx.workflowRouter.getExecutor(sessionId);
            if (!executor) {
                throw new Error(`No active workflow for session: ${sessionId}`);
            }
            const workflowCtx = executor.getContext();
            return {
                sessionId,
                executionHistory: workflowCtx.executionHistory,
                phaseResults: Object.fromEntries(workflowCtx.phaseResults),
                specDir: workflowCtx.specDir,
            };
        }
        case "restore_spec_workflow": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            console.info(`[actions] restore_spec_workflow | sessionId=${sessionId}`);
            // If there's already an active executor, re-emit its state for frontend reconnect
            if (ctx.workflowRouter.hasActiveWorkflow(sessionId)) {
                const activeExecutor = ctx.workflowRouter.getExecutor(sessionId);
                if (activeExecutor) {
                    activeExecutor.reEmitState(sendEvent);
                    const turnId = activeExecutor.getContext().turnId;
                    return { success: true, sessionId, turnId, alreadyActive: true };
                }
                return { success: true, sessionId, alreadyActive: true };
            }
            const session = ctx.getSession(sessionId);
            if (!session) {
                throw new Error(`Session not found: ${sessionId}`);
            }
            const workspacePath = session.workspacePath || ctx.workspacePath || process.cwd();
            const savedState = await loadWorkflowState(workspacePath, sessionId);
            if (!savedState) {
                throw new Error(`No saved workflow state for session: ${sessionId}`);
            }
            const modelConfig = ctx.findModelConfig("spec_workflow");
            if (!modelConfig) {
                throw new Error("Spec workflow model config not found");
            }
            const { turnId, signal } = ctx.beginTurn(sessionId);
            // Override the turnId in the restored context so events use the new turn
            savedState.context.turnId = turnId;
            const executor = SpecWorkflowExecutor.restore(savedState.context, savedState.currentPhaseIndex, modelConfig, signal);
            ctx.workflowRouter.register(sessionId, executor);
            session.state = "processing";
            await ctx.saveSession(session);
            sendEvent({
                event: "agentic://session-state-changed",
                payload: { sessionId, newState: "processing" },
            });
            // Start the restored workflow (async)
            void executor.start(sendEvent).then(() => {
                console.info(`[actions] restored workflow completed | sessionId=${sessionId}`);
                session.state = "idle";
                ctx.saveSession(session);
                // Clean up persisted state on completion
                deleteWorkflowState(workspacePath, sessionId).catch(() => { });
                sendEvent({
                    event: "agentic://session-state-changed",
                    payload: { sessionId, newState: "idle" },
                });
            }).catch((error) => {
                console.error(`[actions] restored workflow error | sessionId=${sessionId}`, error);
                session.state = "idle";
                ctx.saveSession(session);
                sendEvent({
                    event: "agentic://session-state-changed",
                    payload: { sessionId, newState: "idle" },
                });
            }).finally(() => {
                ctx.endTurn(sessionId, turnId);
                ctx.workflowRouter.unregister(sessionId);
            });
            return { success: true, sessionId, turnId, restored: true };
        }
        case "restore_session": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const session = ctx.getSession(sessionId);
            if (!session) {
                throw new Error(`Session not found: ${sessionId}`);
            }
            return toSessionInfo(session);
        }
        case "list_sessions": {
            const wsPath = pickParam(body, ["workspace_path", "workspacePath"])?.toString()
                ?? getGlobalWorkspacePath();
            const allSessions = ctx.listSessions();
            if (wsPath) {
                const normalizedWs = path.resolve(wsPath);
                return allSessions
                    .filter(s => s.workspacePath && path.resolve(s.workspacePath) === normalizedWs)
                    .map(toSessionInfo);
            }
            return allSessions.map(toSessionInfo);
        }
        case "delete_session": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            // 清理快照（对标Rust版本）
            await ctx.cleanupSessionSnapshots(sessionId);
            // 清理持久化的对话轮次和工作流状态
            const delSession = ctx.getSession(sessionId);
            const delWorkspace = delSession?.workspacePath || ctx.workspacePath || process.cwd();
            await deleteDialogTurns(delWorkspace, sessionId).catch(() => { });
            await deleteWorkflowState(delWorkspace, sessionId).catch(() => { });
            // 删除session
            await ctx.removeSession(sessionId);
            return ok();
        }
        case "get_session_messages": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const limit = pickParam(body, ["limit"]);
            const session = ctx.getSession(sessionId);
            if (!session) {
                throw new Error(`Session not found: ${sessionId}`);
            }
            if (!limit || limit <= 0) {
                return session.messages;
            }
            return session.messages.slice(-limit);
        }
        case "generate_session_title": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const userMessage = requireParam(body, ["userMessage", "user_message"], "userMessage").toString();
            const maxLength = Number(pickParam(body, ["maxLength", "max_length"]) ?? 20);
            const title = truncate(userMessage.replace(/\s+/g, " ").trim(), maxLength);
            sendEvent({
                event: "session_title_generated",
                payload: {
                    sessionId,
                    title,
                    method: "fallback",
                    timestamp: nowMs(),
                },
            });
            return title;
        }
        case "get_available_modes":
            return ctx.getAvailableModes().map((m) => ({
                id: m.id,
                name: m.name,
                description: m.description,
                isReadonly: m.isReadonly,
                toolCount: m.toolCount,
                defaultTools: m.defaultTools,
                enabled: m.enabled,
                // 兼容前端不同调用点（snake_case）
                is_readonly: m.isReadonly,
                tool_count: m.toolCount,
                default_tools: m.defaultTools,
            }));
        case "get_mode_configs":
            return cfg.modeConfigs;
        case "get_mode_config": {
            const modeId = requireParam(body, ["modeId", "mode_id"], "modeId").toString();
            if (!cfg.modeConfigs[modeId]) {
                const mode = ctx.getAvailableModes().find((m) => m.id === modeId);
                if (!mode) {
                    throw new Error(`Mode not found: ${modeId}`);
                }
                return {
                    mode_id: modeId,
                    available_tools: mode.defaultTools ?? [],
                    enabled: mode.enabled,
                    default_tools: mode.defaultTools ?? [],
                };
            }
            return cfg.modeConfigs[modeId];
        }
        case "set_mode_config": {
            const modeId = requireParam(body, ["modeId", "mode_id"], "modeId").toString();
            const config = requireParam(body, ["config"], "config");
            cfg.modeConfigs[modeId] = {
                mode_id: String(config.mode_id ?? modeId),
                available_tools: Array.isArray(config.available_tools)
                    ? config.available_tools.map((t) => String(t))
                    : [],
                enabled: Boolean(config.enabled ?? true),
                default_tools: Array.isArray(config.default_tools)
                    ? config.default_tools.map((t) => String(t))
                    : [],
            };
            setByPath(cfg.values, "ai.mode_configs", cfg.modeConfigs);
            await ctx.saveConfigState();
            return ok();
        }
        case "reset_mode_config": {
            const modeId = requireParam(body, ["modeId", "mode_id"], "modeId").toString();
            delete cfg.modeConfigs[modeId];
            setByPath(cfg.values, "ai.mode_configs", cfg.modeConfigs);
            await ctx.saveConfigState();
            return ok();
        }
        case "get_config": {
            const p = pickParam(body, ["path"]);
            const path = p?.toString();
            if (path === "ai.models") {
                return cfg.modelConfigs;
            }
            if (path === "ai.default_models") {
                const fallback = {
                    primary: null,
                    fast: null,
                    search: null,
                    image_understanding: null,
                    image_generation: null,
                    phone_agent: null,
                    speech_recognition: null,
                };
                let defaults = fallback;
                try {
                    const value = getByPath(cfg.values, path);
                    if (value && typeof value === "object" && !Array.isArray(value)) {
                        defaults = { ...fallback, ...value };
                    }
                }
                catch {
                    defaults = fallback;
                }
                // 对齐 Rust：确保 primary/fast 指向可用模型
                const enabledModels = cfg.modelConfigs.filter((m) => m.enabled !== false);
                const preferredModelId = enabledModels[0]?.id ?? cfg.modelConfigs[0]?.id ?? null;
                const isValid = (id) => typeof id === "string" && enabledModels.some((m) => m.id === id);
                let changed = false;
                if (!isValid(defaults.primary) && preferredModelId) {
                    defaults.primary = preferredModelId;
                    changed = true;
                }
                if (!isValid(defaults.fast) && preferredModelId) {
                    defaults.fast = preferredModelId;
                    changed = true;
                }
                if (changed) {
                    setByPath(cfg.values, "ai.default_models", defaults);
                    await ctx.saveConfigState();
                }
                return defaults;
            }
            if (path === "ai.mode_configs") {
                return cfg.modeConfigs;
            }
            if (path === "ai.subagent_configs") {
                return cfg.subagentConfigs;
            }
            if (path === "ai.agent_models") {
                try {
                    const value = getByPath(cfg.values, path);
                    if (value && typeof value === "object" && !Array.isArray(value)) {
                        return value;
                    }
                    return {};
                }
                catch {
                    return {};
                }
            }
            return getByPath(cfg.values, path);
        }
        case "set_config": {
            const p = requireParam(body, ["path"], "path").toString();
            if (!Object.prototype.hasOwnProperty.call(body, "value")) {
                throw new Error("value required");
            }
            setByPath(cfg.values, p, body.value);
            if (p === "ai.models" && Array.isArray(body.value)) {
                cfg.modelConfigs = body.value;
            }
            if (p === "ai.mode_configs" && body.value && typeof body.value === "object" && !Array.isArray(body.value)) {
                cfg.modeConfigs = body.value;
            }
            if (p === "ai.subagent_configs" && body.value && typeof body.value === "object" && !Array.isArray(body.value)) {
                cfg.subagentConfigs = body.value;
            }
            // 同步 DevEco Studio 路径到环境变量和编译工具
            if (p === "hmos.deveco_home") {
                const devecoHome = typeof body.value === "string" ? body.value : undefined;
                if (devecoHome) {
                    process.env.DEVECO_HOME = devecoHome;
                }
                else {
                    delete process.env.DEVECO_HOME;
                }
                setUserDevecoHome(devecoHome);
                console.info(`[COVERAGE][actions] set_config: hmos.deveco_home synced to env | value=${devecoHome}`);
            }
            await ctx.saveConfigState();
            return ok();
        }
        case "reset_config": {
            const p = pickParam(body, ["path"]);
            if (p) {
                deleteByPath(cfg.values, p.toString());
            }
            else {
                cfg.values = {
                    ai: {
                        models: cfg.modelConfigs,
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
                        mode_configs: cfg.modeConfigs,
                        subagent_configs: cfg.subagentConfigs,
                    },
                };
            }
            await ctx.saveConfigState();
            return ok();
        }
        case "validate_config":
            return { valid: true, errors: [], warnings: [] };
        case "export_config":
            return {
                config: cfg.values,
                export_timestamp: new Date().toISOString(),
                version: ctx.version,
            };
        case "import_config": {
            const data = requireParam(body, ["configData", "config_data"], "configData");
            const imported = data.config;
            if (!imported || typeof imported !== "object" || Array.isArray(imported)) {
                throw new Error("configData.config required");
            }
            cfg.values = imported;
            try {
                const models = getByPath(cfg.values, "ai.models");
                if (Array.isArray(models)) {
                    cfg.modelConfigs = models;
                }
            }
            catch {
                setByPath(cfg.values, "ai.models", cfg.modelConfigs);
            }
            try {
                const modeConfigs = getByPath(cfg.values, "ai.mode_configs");
                if (modeConfigs && typeof modeConfigs === "object" && !Array.isArray(modeConfigs)) {
                    cfg.modeConfigs = modeConfigs;
                }
            }
            catch {
                setByPath(cfg.values, "ai.mode_configs", cfg.modeConfigs);
            }
            try {
                const subagentConfigs = getByPath(cfg.values, "ai.subagent_configs");
                if (subagentConfigs && typeof subagentConfigs === "object" && !Array.isArray(subagentConfigs)) {
                    cfg.subagentConfigs = subagentConfigs;
                }
            }
            catch {
                setByPath(cfg.values, "ai.subagent_configs", cfg.subagentConfigs);
            }
            try {
                getByPath(cfg.values, "ai.agent_models");
            }
            catch {
                setByPath(cfg.values, "ai.agent_models", {});
            }
            try {
                getByPath(cfg.values, "ai.default_models");
            }
            catch {
                setByPath(cfg.values, "ai.default_models", {
                    primary: null,
                    fast: null,
                    search: null,
                    image_understanding: null,
                    image_generation: null,
                    phone_agent: null,
                    speech_recognition: null,
                });
            }
            await ctx.saveConfigState();
            return { success: true, errors: [], warnings: [] };
        }
        case "reload_config":
            return ok();
        case "get_model_configs":
            return cfg.modelConfigs;
        case "save_model_config": {
            const model = requireParam(body, ["config"], "config");
            const id = String(model.id ?? "");
            if (!id) {
                throw new Error("config.id required");
            }
            const next = {
                id,
                name: String(model.name ?? id),
                provider: String(model.provider ?? model.format ?? "openai"),
                model_name: String(model.model_name ?? model.modelName ?? model.model ?? ""),
                base_url: model.base_url ? String(model.base_url) : model.baseUrl ? String(model.baseUrl) : undefined,
                api_key: model.api_key ? String(model.api_key) : model.apiKey ? String(model.apiKey) : undefined,
                context_window: Number(model.context_window ?? model.contextWindow ?? 0) || undefined,
                max_tokens: Number(model.max_tokens ?? model.maxTokens ?? 0) || undefined,
                enabled: model.enabled !== false,
                enable_thinking_process: Boolean(model.enable_thinking_process ?? model.enableThinkingProcess ?? false),
                support_preserved_thinking: Boolean(model.support_preserved_thinking ?? model.supportPreservedThinking ?? false),
                custom_headers: model.custom_headers && typeof model.custom_headers === "object"
                    ? model.custom_headers
                    : model.customHeaders && typeof model.customHeaders === "object"
                        ? model.customHeaders
                        : undefined,
                custom_headers_mode: model.custom_headers_mode
                    ? String(model.custom_headers_mode)
                    : model.customHeadersMode
                        ? String(model.customHeadersMode)
                        : undefined,
                skip_ssl_verify: Boolean(model.skip_ssl_verify ?? model.skipSslVerify ?? false),
                custom_request_body: model.custom_request_body
                    ? String(model.custom_request_body)
                    : model.customRequestBody
                        ? String(model.customRequestBody)
                        : undefined,
            };
            const idx = cfg.modelConfigs.findIndex((m) => m.id === id);
            if (idx >= 0) {
                cfg.modelConfigs[idx] = next;
            }
            else {
                cfg.modelConfigs.push(next);
            }
            setByPath(cfg.values, "ai.models", cfg.modelConfigs);
            await ctx.saveConfigState();
            return ok();
        }
        case "delete_model_config": {
            const configId = requireParam(body, ["configId", "config_id"], "configId").toString();
            cfg.modelConfigs = cfg.modelConfigs.filter((m) => m.id !== configId);
            setByPath(cfg.values, "ai.models", cfg.modelConfigs);
            await ctx.saveConfigState();
            return ok();
        }
        case "test_ai_connection":
        case "test_ai_config_connection": {
            const modelName = pickParam(body, ["model_name", "modelName", "model"]);
            const provider = pickParam(body, ["provider", "format"]);
            const baseUrl = pickParam(body, ["base_url", "baseUrl"]);
            console.log(body);
            if (!modelName)
                throw new Error("model_name required");
            if (!provider)
                throw new Error("format required");
            if (!baseUrl)
                throw new Error("base_url required");
            return {
                success: true,
                latency_ms: 1,
                model: modelName,
                provider,
            };
        }
        case "initialize_ai":
            return ok();
        case "get_session_turns": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const session = ctx.getSession(sessionId);
            if (!session) {
                throw new Error(`Session not found: ${sessionId}`);
            }
            return session.turns.map((turn, index) => ({
                turnIndex: index,
                turnId: turn.turnId,
                createdAt: turn.createdAt,
            }));
        }
        case "get_turn_files": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const turnIndex = Number(requireParam(body, ["turnIndex", "turn_index"], "turnIndex"));
            const session = ctx.getSession(sessionId);
            if (!session) {
                throw new Error(`Session not found: ${sessionId}`);
            }
            if (turnIndex < 0 || turnIndex >= session.turns.length) {
                throw new Error("turnIndex out of range");
            }
            return session.turns[turnIndex].files;
        }
        case "get_session_files": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const session = ctx.getSession(sessionId);
            if (!session) {
                throw new Error(`Session not found: ${sessionId}`);
            }
            return Array.from(new Set(session.turns.flatMap((turn) => turn.files)));
        }
        case "rollback_to_turn": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const turnIndex = Number(requireParam(body, ["turnIndex", "turn_index"], "turnIndex"));
            const session = ctx.getSession(sessionId);
            if (!session) {
                throw new Error(`Session not found: ${sessionId}`);
            }
            if (turnIndex < 0 || turnIndex >= session.turns.length) {
                throw new Error("turnIndex out of range");
            }
            const kept = session.turns.slice(0, turnIndex + 1);
            session.turns = kept;
            session.turnCount = kept.length;
            await ctx.saveSession(session);
            return Array.from(new Set(kept.flatMap((turn) => turn.files)));
        }
        case "rollback_session": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const session = ctx.getSession(sessionId);
            if (!session) {
                throw new Error(`Session not found: ${sessionId}`);
            }
            const files = Array.from(new Set(session.turns.flatMap((turn) => turn.files)));
            session.turns = [];
            session.messages = [];
            session.turnCount = 0;
            session.state = "idle";
            await ctx.saveSession(session);
            return files;
        }
        case "get_subagent_configs": {
            if (Object.keys(cfg.subagentConfigs).length === 0) {
                for (const sub of ctx.getBuiltinSubagents()) {
                    cfg.subagentConfigs[sub.id] = { enabled: true };
                }
                setByPath(cfg.values, "ai.subagent_configs", cfg.subagentConfigs);
                await ctx.saveConfigState();
            }
            return cfg.subagentConfigs;
        }
        case "set_subagent_config": {
            const subagentId = requireParam(body, ["subagentId", "subagent_id"], "subagentId").toString();
            const enabled = Boolean(pickParam(body, ["enabled"]) ?? true);
            cfg.subagentConfigs[subagentId] = { enabled };
            setByPath(cfg.values, "ai.subagent_configs", cfg.subagentConfigs);
            await ctx.saveConfigState();
            return ok();
        }
        case "get_builtin_sub_agents":
            return ctx.getBuiltinSubagents();
        case "get_all_tools_info":
            return ctx.getToolInfos();
        case "check_deveco_home": {
            // 使用 findDevecoHome 统一查找：用户配置 > process.env > 注册表 > 自动探测
            const devecoPath = await findDevecoHome();
            if (devecoPath) {
                return { is_configured: true, deveco_home: devecoPath };
            }
            return { is_configured: false };
        }
        case "get_available_tools":
            return ctx.getToolInfos().map((tool) => tool.name);
        case "get_tool_info": {
            const toolName = requireParam(body, ["toolName", "tool_name"], "toolName").toString();
            const tool = ctx.getToolInfos().find((item) => item.name === toolName);
            if (!tool) {
                throw new Error(`Tool not found: ${toolName}`);
            }
            return tool;
        }
        case "is_tool_enabled": {
            const toolName = requireParam(body, ["toolName", "tool_name"], "toolName").toString();
            const tool = ctx.getToolInfos().find((item) => item.name === toolName);
            if (!tool) {
                throw new Error(`Tool not found: ${toolName}`);
            }
            return true;
        }
        case "confirm_tool_execution":
        case "reject_tool_execution":
            requireParam(body, ["toolUseId", "tool_use_id", "toolId", "tool_id"], "tool_use_id");
            return ok();
        case "validate_tool_input":
            return { valid: true, errors: [] };
        case "execute_tool": {
            const sessionId = pickParam(body, ["sessionId", "session_id"]);
            const toolName = pickParam(body, ["toolName", "tool_name"]);
            const toolInput = pickParam(body, ["toolInput", "tool_input"]);
            const turnIndex = pickParam(body, ["turnIndex", "turn_index"]) ?? 0;
            console.info(`🔧 [RPC] execute_tool: ${toolName} for session ${sessionId}`);
            console.info(`   输入参数:`, JSON.stringify(toolInput, null, 2));
            if (!sessionId || !toolName || !toolInput) {
                throw new Error("缺少必要参数: sessionId, toolName, toolInput");
            }
            // 获取session
            const session = ctx.storage.getSession(sessionId);
            if (!session) {
                throw new Error(`Session不存在: ${sessionId}`);
            }
            // 获取工具
            const tool = getGlobalToolRegistry().get(toolName);
            if (!tool) {
                throw new Error(`工具不存在: ${toolName}`);
            }
            const toolId = genId("tool");
            const turnId = genId("turn");
            try {
                // 构建工具上下文
                const toolContext = {
                    session_id: sessionId,
                    turn_id: turnId,
                    turn_index: turnIndex,
                    workspace_path: session.workspacePath,
                    tool_call_id: toolId,
                };
                // 发送开始事件
                sendEvent({
                    event: "agentic://tool-event",
                    payload: {
                        sessionId,
                        turnId,
                        toolEvent: {
                            event_type: "Started",
                            tool_id: toolId,
                            tool_name: toolName,
                            result: null,
                            duration_ms: 0,
                            from_cache: false,
                        },
                    },
                });
                // 执行工具
                const startTime = Date.now();
                const toolCallInput = {
                    tool_id: toolId,
                    tool_name: toolName,
                    arguments: toolInput,
                };
                const result = await tool.execute(toolCallInput, toolContext);
                const duration = Date.now() - startTime;
                // 发送完成事件
                sendEvent({
                    event: "agentic://tool-event",
                    payload: {
                        sessionId,
                        turnId,
                        toolEvent: {
                            event_type: "Completed",
                            tool_id: toolId,
                            tool_name: toolName,
                            result: result,
                            duration_ms: duration,
                            from_cache: false,
                        },
                    },
                });
                return {
                    toolUseId: toolId,
                    success: true,
                    result: result,
                };
            }
            catch (error) {
                // 发送失败事件
                sendEvent({
                    event: "agentic://tool-event",
                    payload: {
                        sessionId,
                        turnId,
                        toolEvent: {
                            event_type: "Failed",
                            tool_id: toolId,
                            tool_name: toolName,
                            result: { error: error.message },
                            duration_ms: 0,
                            from_cache: false,
                        },
                    },
                });
                throw error;
            }
        }
        case "cancel_tool_execution":
            return ok();
        case "submit_user_answers":
            return ok();
        case "execute_subagent_task":
            return "Subagent task queued";
        case "sync_tool_configs":
            return {
                new_tools: [],
                deleted_tools: [],
                updated_modes: [],
            };
        case "get_skill_configs":
            return [];
        case "set_skill_enabled":
            return ok();
        case "validate_skill_path":
            return { isValid: true, reason: null };
        case "add_skill":
        case "delete_skill":
            return ok();
        case "i18n_get_config":
            return {};
        case "get_mcp_servers":
            return cfg.mcpServers;
        case "initialize_mcp_servers":
            return ok();
        case "start_mcp_server":
        case "stop_mcp_server":
        case "restart_mcp_server": {
            const serverId = requireParam(body, ["serverId", "server_id"], "serverId").toString();
            const server = cfg.mcpServers.find((s) => s.id === serverId);
            if (!server) {
                throw new Error(`server not found: ${serverId}`);
            }
            if (action === "start_mcp_server")
                server.status = "healthy";
            if (action === "stop_mcp_server")
                server.status = "stopped";
            if (action === "restart_mcp_server")
                server.status = "healthy";
            await ctx.saveConfigState();
            return ok();
        }
        case "get_mcp_server_status": {
            const serverId = requireParam(body, ["serverId", "server_id"], "serverId").toString();
            const server = cfg.mcpServers.find((s) => s.id === serverId);
            if (!server) {
                throw new Error(`server not found: ${serverId}`);
            }
            return server.status;
        }
        case "add_mcp_server": {
            const config = requireParam(body, ["config"], "config");
            const id = String(config.id ?? "");
            if (!id) {
                throw new Error("config.id required");
            }
            cfg.mcpServers.push({
                id,
                name: String(config.name ?? id),
                status: "stopped",
                serverType: String(config.type ?? "local"),
                enabled: Boolean(config.enabled ?? true),
                autoStart: Boolean(config.autoStart ?? false),
            });
            await ctx.saveConfigState();
            return ok();
        }
        case "remove_mcp_server": {
            const serverId = requireParam(body, ["serverId", "server_id"], "serverId").toString();
            cfg.mcpServers = cfg.mcpServers.filter((s) => s.id !== serverId);
            await ctx.saveConfigState();
            return ok();
        }
        case "update_mcp_server": {
            const config = requireParam(body, ["config"], "config");
            const id = String(config.id ?? "");
            if (!id) {
                throw new Error("config.id required");
            }
            const server = cfg.mcpServers.find((s) => s.id === id);
            if (!server) {
                throw new Error(`server not found: ${id}`);
            }
            server.name = String(config.name ?? server.name);
            server.serverType = String(config.type ?? server.serverType);
            server.enabled = Boolean(config.enabled ?? server.enabled);
            server.autoStart = Boolean(config.autoStart ?? server.autoStart);
            await ctx.saveConfigState();
            return ok();
        }
        case "load_mcp_json_config":
            return ctx.getMcpJsonConfig();
        case "save_mcp_json_config": {
            const jsonConfig = requireParam(body, ["jsonConfig"], "jsonConfig").toString();
            ctx.setMcpJsonConfig(jsonConfig);
            return ok();
        }
        case "rollback_context_to_turn": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const targetTurn = requireParam(body, ["targetTurn", "target_turn", "turn_index"], "targetTurn");
            const session = ctx.getSession(sessionId);
            if (!session) {
                throw new Error(`Session not found: ${sessionId}`);
            }
            console.info(`⏪ [RPC] 回滚上下文请求: session=${sessionId}, targetTurn=${targetTurn}`);
            // 执行回滚
            const messages = await ctx.rollbackContextToTurn(sessionId, targetTurn);
            // 发送回滚完成事件
            sendEvent({
                event: "agentic://context-rollback-completed",
                payload: {
                    sessionId,
                    targetTurn,
                    messageCount: messages.length,
                    turnCount: session.turnCount,
                },
            });
            return {
                success: true,
                sessionId,
                targetTurn,
                messageCount: messages.length,
                turnCount: session.turnCount,
            };
        }
        case "list_turn_snapshots": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const snapshots = await ctx.sessionManager.listTurnSnapshots(sessionId);
            return {
                sessionId,
                snapshots,
            };
        }
        // ============ 文件快照系统接口 ============
        case "rollback_session_files": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            console.info(`⏪ [RPC] 回滚session文件: ${sessionId}`);
            const result = await ctx.rollbackSessionFiles(sessionId);
            sendEvent({
                event: "agentic://files-rollback-completed",
                payload: {
                    sessionId,
                    restoredFiles: result.restoredFiles,
                    successCount: result.successCount,
                    failureCount: result.failureCount,
                },
            });
            return {
                success: true,
                ...result,
            };
        }
        case "rollback_to_turn_files": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const turnIndex = requireParam(body, ["turnIndex", "turn_index"], "turnIndex");
            console.info(`⏪ [RPC] 回滚到turn ${turnIndex}的文件: ${sessionId}`);
            const result = await ctx.rollbackToTurnFiles(sessionId, turnIndex);
            sendEvent({
                event: "agentic://files-rollback-completed",
                payload: {
                    sessionId,
                    turnIndex,
                    restoredFiles: result.restoredFiles,
                    successCount: result.successCount,
                    failureCount: result.failureCount,
                },
            });
            return {
                success: true,
                turnIndex,
                ...result,
            };
        }
        case "get_session_modified_files": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const files = await ctx.getSessionModifiedFiles(sessionId);
            return {
                sessionId,
                files,
                count: files.length,
            };
        }
        case "get_file_change_history": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            const filePath = requireParam(body, ["filePath", "file_path"], "filePath").toString();
            const history = await ctx.getFileChangeHistory(sessionId, filePath);
            return {
                sessionId,
                filePath,
                history,
                count: history.length,
            };
        }
        case "accept_session_changes": {
            const sessionId = requireParam(body, ["sessionId", "session_id"], "sessionId").toString();
            console.info(`✅ [RPC] 接受session修改: ${sessionId}`);
            await ctx.acceptSessionChanges(sessionId);
            sendEvent({
                event: "agentic://session-changes-accepted",
                payload: { sessionId },
            });
            return ok();
        }
        case "get_snapshot_stats": {
            const stats = await ctx.getSnapshotStats();
            return stats;
        }
        // ─── 工作区管理 ─────────────────────────────────────────
        case "open_workspace": {
            const workspacePath = requireParam(body, ["path", "workspacePath", "workspace_path"], "path").toString();
            const resolvedPath = path.resolve(workspacePath);
            if (!fs.existsSync(resolvedPath)) {
                throw new Error(`Workspace path does not exist: ${resolvedPath}`);
            }
            // 更新全局 workspace
            setGlobalWorkspacePath(resolvedPath);
            // 切换 Storage 到新 workspace，重新加载该 workspace 下的 sessions
            await ctx.switchWorkspace(resolvedPath);
            const dirName = path.basename(resolvedPath);
            const workspace = {
                id: genId("ws"),
                name: dirName,
                rootPath: resolvedPath,
                workspaceType: "local",
                type: "local",
                languages: [],
                filesCount: 0,
                openedAt: new Date().toISOString(),
                lastAccessed: new Date().toISOString(),
                description: "",
                tags: [],
            };
            // 存入最近工作区列表
            const recentKey = "__recent_workspaces__";
            const existing = ctx[recentKey] ?? [];
            // 去重（按 rootPath）
            const filtered = existing.filter((w) => w.rootPath !== resolvedPath);
            filtered.unshift(workspace);
            // 最多保留 10 条
            ctx[recentKey] = filtered.slice(0, 10);
            return workspace;
        }
        case "get_recent_workspaces": {
            const recentKey = "__recent_workspaces__";
            const recent = ctx[recentKey] ?? [];
            return recent;
        }
        case "close_workspace": {
            setGlobalWorkspacePath(undefined);
            return { success: true };
        }
        case "get_current_workspace": {
            const wp = getGlobalWorkspacePath();
            if (!wp)
                return null;
            const dirName = path.basename(wp);
            return {
                id: "current",
                name: dirName,
                rootPath: wp,
                workspaceType: "local",
                type: "local",
                languages: [],
                filesCount: 0,
                openedAt: new Date().toISOString(),
                lastAccessed: new Date().toISOString(),
                description: "",
                tags: [],
            };
        }
        case "cleanup_recent_workspaces": {
            const recentKey = "__recent_workspaces__";
            ctx[recentKey] = [];
            return { success: true };
        }
        case "scan_workspace_info": {
            const workspacePath = requireParam(body, ["workspacePath", "workspace_path", "path"], "workspacePath").toString();
            const resolvedPath = path.resolve(workspacePath);
            if (!fs.existsSync(resolvedPath)) {
                return null;
            }
            const dirName = path.basename(resolvedPath);
            return {
                id: genId("ws"),
                name: dirName,
                rootPath: resolvedPath,
                workspaceType: "local",
                type: "local",
                languages: [],
                filesCount: 0,
                openedAt: new Date().toISOString(),
                lastAccessed: new Date().toISOString(),
                description: "",
                tags: [],
            };
        }
        case "start_file_watch":
        case "stop_file_watch":
            return { success: true };
        // ============ 对话历史持久化 (ConversationAPI) ============
        case "save_dialog_turn": {
            const turnData = pickParam(body, ["turn_data", "turnData"]);
            const workspacePath = pickParam(body, ["workspace_path", "workspacePath"]);
            if (turnData && workspacePath) {
                const sid = turnData.sessionId ?? pickParam(body, ["session_id", "sessionId"]);
                if (sid) {
                    await saveDialogTurnToFile(workspacePath.toString(), sid.toString(), turnData);
                }
            }
            return ok();
        }
        case "save_session_metadata": {
            const metadata = pickParam(body, ["metadata"]);
            if (metadata?.sessionId) {
                const session = ctx.getSession(metadata.sessionId);
                if (session) {
                    if (metadata.agentType)
                        session.agentType = metadata.agentType;
                    if (metadata.sessionName)
                        session.sessionName = metadata.sessionName;
                    await ctx.saveSession(session);
                }
            }
            return ok();
        }
        case "save_compilation_fix_snapshot": {
            const sessionId = pickParam(body, ["session_id", "sessionId"]);
            const workspacePath = pickParam(body, ["workspace_path", "workspacePath"]);
            const snapshot = pickParam(body, ["snapshot"]);
            if (sessionId && workspacePath && snapshot) {
                await saveCompilationFixSnapshot(workspacePath.toString(), sessionId.toString(), snapshot);
            }
            return ok();
        }
        case "load_compilation_fix_snapshot": {
            const sessionId = pickParam(body, ["session_id", "sessionId"]);
            const workspacePath = pickParam(body, ["workspace_path", "workspacePath"]);
            if (sessionId && workspacePath) {
                const snapshot = await loadCompilationFixSnapshot(workspacePath.toString(), sessionId.toString());
                return snapshot;
            }
            return null;
        }
        case "load_conversation_history": {
            const sessionId = pickParam(body, ["session_id", "sessionId"]);
            const workspacePath = pickParam(body, ["workspace_path", "workspacePath"]);
            if (sessionId && workspacePath) {
                const turns = await loadDialogTurns(workspacePath.toString(), sessionId.toString());
                if (turns.length > 0) {
                    return turns;
                }
            }
            // fallback: return basic turn data from in-memory session
            if (sessionId) {
                const session = ctx.getSession(sessionId.toString());
                if (!session)
                    return [];
                return session.turns.map((turn, index) => ({
                    turnId: turn.turnId,
                    turnIndex: index,
                    sessionId: session.sessionId,
                    timestamp: turn.createdAt,
                    userMessage: { id: turn.turnId, content: turn.userInput, timestamp: turn.createdAt },
                    modelRounds: [],
                    startTime: turn.createdAt,
                    status: "completed",
                }));
            }
            return [];
        }
        case "get_conversation_sessions": {
            const wsPath = pickParam(body, ["workspace_path", "workspacePath"])?.toString()
                ?? getGlobalWorkspacePath();
            const allSessions = ctx.listSessions();
            if (wsPath) {
                const normalizedWs = path.resolve(wsPath);
                return allSessions
                    .filter(s => s.workspacePath && path.resolve(s.workspacePath) === normalizedWs)
                    .map(toSessionInfo);
            }
            return allSessions.map(toSessionInfo);
        }
        case "delete_conversation_history": {
            const sessionId = pickParam(body, ["session_id", "sessionId"]);
            if (sessionId) {
                await ctx.removeSession(sessionId.toString());
            }
            return ok();
        }
        case "touch_conversation_session": {
            return ok();
        }
        case "load_session_metadata": {
            const sessionId = pickParam(body, ["session_id", "sessionId"]);
            if (sessionId) {
                const session = ctx.getSession(sessionId.toString());
                if (session)
                    return toSessionInfo(session);
            }
            return null;
        }
        case "git_is_repository": {
            return ok();
        }
        default:
            throw new Error(`Unknown action: ${action}`);
    }
}
//# sourceMappingURL=actions.js.map