/**
 * 轮次执行器
 * 协调 AI 调用、流式输出和工具执行
 */
import { StreamProcessor } from "./stream_processor.js";
import { ToolExecutor } from "./tool_executor.js";
import { getAllToolDefinitions } from "../tools/registry.js";
/**
 * 轮次执行器
 */
export class RoundExecutor {
    stream_processor = new StreamProcessor();
    tool_executor = new ToolExecutor();
    /**
     * 执行单个模型轮次
     */
    async execute_round(model_config, messages, context, emit_event) {
        const round_id = `r-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        // 发送轮次开始事件
        emit_event?.({
            event: "agentic://model-round-started",
            payload: {
                sessionId: context.session_id,
                turnId: context.turn_id,
                roundId: round_id,
                roundIndex: context.round_number,
            },
        });
        // 调用 AI 模型
        const stream_result = await this.call_ai_with_tools(model_config, messages, context, round_id, emit_event);
        // 执行工具调用
        let tool_results = [];
        if (stream_result.tool_calls.length > 0) {
            tool_results = await this.execute_tools(stream_result.tool_calls, context, round_id, emit_event);
        }
        // 检查是否应该继续
        const has_tool_calls = stream_result.tool_calls.length > 0;
        const has_end_turn_tool = this.tool_executor.has_end_turn_tool(stream_result.tool_calls);
        const should_continue = has_tool_calls && !has_end_turn_tool;
        // 发送轮次完成事件
        emit_event?.({
            event: "agentic://model-round-completed",
            payload: {
                sessionId: context.session_id,
                turnId: context.turn_id,
                roundId: round_id,
                hasToolCalls: has_tool_calls,
            },
        });
        return {
            text: stream_result.text,
            tool_calls: stream_result.tool_calls,
            tool_results,
            finish_reason: stream_result.finish_reason,
            usage: stream_result.usage,
            has_tool_calls,
            should_continue,
        };
    }
    /**
     * 调用 AI 并处理流式响应
     */
    async call_ai_with_tools(model_config, messages, context, round_id, emit_event) {
        const { base_url, model_name, api_key, custom_headers, custom_request_body } = model_config;
        if (!base_url || !model_name) {
            throw new Error("AI model configuration is incomplete");
        }
        // 构建请求 URL
        const url = base_url.endsWith("/chat/completions")
            ? base_url
            : `${base_url.replace(/\/$/, "")}/chat/completions`;
        // 获取工具定义
        const tool_definitions = this.get_tool_definitions(context.allowed_tool_names);
        // 构建请求体
        const payload = {
            model: model_name,
            messages: this.convert_messages(messages),
            temperature: 0.7,
            stream: true,
            tools: tool_definitions.length > 0 ? tool_definitions : undefined,
        };
        // 合并自定义请求体（覆盖默认字段）
        if (custom_request_body) {
            try {
                const extra = JSON.parse(custom_request_body);
                if (extra && typeof extra === "object" && !Array.isArray(extra)) {
                    Object.assign(payload, extra);
                }
            }
            catch (e) {
                console.warn(`Failed to parse custom_request_body: ${e}`);
            }
        }
        const { messages: _msgs, ...payloadForLog } = payload;
        console.log(`[RoundExecutor] request payload (without messages): ${JSON.stringify(payloadForLog)}`);
        // 发送请求（不使用 signal，避免 AbortError）
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(api_key ? { Authorization: `Bearer ${api_key}` } : {}),
                ...(custom_headers || {}),
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const error_text = await response.text();
            throw new Error(`AI request failed: ${response.status} ${error_text}`);
        }
        // 检查是否已取消
        if (context.signal?.aborted) {
            throw new Error("Request was cancelled");
        }
        // 处理流式响应
        const stream = this.stream_processor.response_to_stream(response, context.signal);
        const result = await this.stream_processor.process_openai_stream(stream, (text) => {
            // 发送文本块事件
            emit_event?.({
                event: "agentic://text-chunk",
                payload: {
                    sessionId: context.session_id,
                    turnId: context.turn_id,
                    roundId: round_id,
                    text,
                },
            });
        }, undefined, // on_tool_call 不在这里使用
        (tool_event) => {
            // 发送工具事件（EarlyDetected, ParamsPartial）
            emit_event?.({
                event: "agentic://tool-event",
                payload: {
                    sessionId: context.session_id,
                    turnId: context.turn_id,
                    roundId: round_id,
                    toolEvent: tool_event,
                },
            });
        });
        return result;
    }
    /**
     * 执行工具调用
     */
    async execute_tools(tool_calls, context, round_id, emit_event) {
        const tool_context = {
            session_id: context.session_id,
            turn_id: context.turn_id,
            turn_index: context.turn_index, // 传递turn_index
            workspace_path: context.workspace_path,
            signal: context.signal,
        };
        const on_tool_event = (event) => {
            emit_event?.({
                event: "agentic://tool-event",
                payload: {
                    sessionId: context.session_id,
                    turnId: context.turn_id,
                    roundId: round_id,
                    toolEvent: event,
                },
            });
        };
        return this.tool_executor.execute_tools(tool_calls, tool_context, { concurrent: true, max_concurrent: 5 }, on_tool_event);
    }
    /**
     * 获取工具定义
     */
    get_tool_definitions(allowedToolNames) {
        // 从工具注册表获取所有工具定义
        const definitions = getAllToolDefinitions().filter((def) => {
            if (!allowedToolNames || allowedToolNames.length === 0) {
                return true;
            }
            return allowedToolNames.includes(def.name);
        });
        console.info(`[RoundExecutor] 获取工具定义: allowed=${allowedToolNames?.length ?? 0}, selected=${definitions.length}`);
        // 转换为 OpenAI 格式
        return definitions.map((def) => ({
            type: "function",
            function: {
                name: def.name,
                description: def.description,
                parameters: def.input_schema,
            },
        }));
    }
    /**
     * 转换消息格式
     */
    convert_messages(messages) {
        return messages.map((msg) => {
            const base = {
                role: msg.role,
                content: msg.content || null,
            };
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                base.tool_calls = msg.tool_calls.map((call) => ({
                    id: call.tool_id,
                    type: "function",
                    function: {
                        name: call.tool_name,
                        arguments: JSON.stringify(call.arguments),
                    },
                }));
            }
            if (msg.tool_call_id) {
                base.tool_call_id = msg.tool_call_id;
            }
            if (msg.name) {
                base.name = msg.name;
            }
            return base;
        });
    }
}
//# sourceMappingURL=round_executor.js.map