/**
 * 流式处理器
 * 处理 AI 的流式响应，提取文本、工具调用等
 */
/**
 * JSON 检查器 - 用于检测流式 JSON 是否完整
 */
class JsonChecker {
    buffer = "";
    append(text) {
        this.buffer += text;
    }
    get_buffer() {
        return this.buffer;
    }
    is_valid() {
        if (!this.buffer.trim()) {
            return false;
        }
        try {
            JSON.parse(this.buffer);
            return true;
        }
        catch {
            return false;
        }
    }
    reset() {
        this.buffer = "";
    }
}
/**
 * 工具调用缓冲区
 */
class ToolCallBuffer {
    tool_id = "";
    tool_name = "";
    json_checker = new JsonChecker();
    early_detected_sent = false;
    last_params_partial = "";
    get_tool_id() {
        return this.tool_id;
    }
    get_tool_name() {
        return this.tool_name;
    }
    get_params_buffer() {
        return this.json_checker.get_buffer();
    }
    has_early_detected() {
        return this.early_detected_sent;
    }
    set_early_detected() {
        this.early_detected_sent = true;
    }
    get_last_params_partial() {
        return this.last_params_partial;
    }
    set_last_params_partial(params) {
        this.last_params_partial = params;
    }
    set_id(id) {
        this.tool_id = id;
    }
    set_name(name) {
        this.tool_name = name;
    }
    append(text) {
        this.json_checker.append(text);
    }
    is_valid() {
        return this.json_checker.is_valid();
    }
    to_tool_call() {
        if (!this.tool_id || !this.tool_name) {
            return null;
        }
        const buffer = this.json_checker.get_buffer();
        try {
            const arguments_obj = JSON.parse(buffer);
            return {
                tool_id: this.tool_id,
                tool_name: this.tool_name,
                arguments: arguments_obj,
            };
        }
        catch (error) {
            console.error(`Failed to parse tool arguments: ${error}`);
            return {
                tool_id: this.tool_id,
                tool_name: this.tool_name,
                arguments: {},
            };
        }
    }
    reset() {
        this.tool_id = "";
        this.tool_name = "";
        this.json_checker.reset();
        this.early_detected_sent = false;
        this.last_params_partial = "";
    }
}
/**
 * 流式处理器
 */
export class StreamProcessor {
    /**
     * 处理 OpenAI 格式的流式响应
     */
    async process_openai_stream(stream, on_text_chunk, on_tool_call, on_tool_event) {
        const text_chunks = [];
        const tool_calls = [];
        let finish_reason;
        let usage;
        // 工具调用缓冲区（支持多个并发工具调用）
        const tool_buffers = new Map();
        try {
            for await (const chunk of stream) {
                // 解析 SSE 格式
                const lines = chunk.split("\n");
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith("data:")) {
                        continue;
                    }
                    const data = trimmed.slice(5).trim();
                    if (data === "[DONE]") {
                        continue;
                    }
                    if (!data) {
                        continue;
                    }
                    try {
                        const json = JSON.parse(data);
                        // 处理文本内容
                        const delta = json.choices?.[0]?.delta;
                        if (delta?.content) {
                            text_chunks.push(delta.content);
                            on_text_chunk?.(delta.content);
                        }
                        // 处理工具调用
                        if (delta?.tool_calls) {
                            for (const tool_call of delta.tool_calls) {
                                const index = tool_call.index ?? 0;
                                let buffer = tool_buffers.get(index);
                                if (!buffer) {
                                    buffer = new ToolCallBuffer();
                                    tool_buffers.set(index, buffer);
                                }
                                if (tool_call.id) {
                                    buffer.set_id(tool_call.id);
                                }
                                if (tool_call.function?.name) {
                                    buffer.set_name(tool_call.function.name);
                                }
                                if (tool_call.function?.arguments) {
                                    buffer.append(tool_call.function.arguments);
                                }
                                // 发送 EarlyDetected 事件（只发送一次）
                                if (buffer.get_tool_id() && buffer.get_tool_name() && !buffer.has_early_detected()) {
                                    buffer.set_early_detected();
                                    on_tool_event?.({
                                        event_type: "EarlyDetected",
                                        tool_id: buffer.get_tool_id(),
                                        tool_name: buffer.get_tool_name(),
                                    });
                                }
                                // 发送 ParamsPartial 事件（参数累积变化时）
                                const currentParams = buffer.get_params_buffer();
                                if (currentParams &&
                                    currentParams !== buffer.get_last_params_partial() &&
                                    buffer.get_tool_id() &&
                                    buffer.get_tool_name()) {
                                    buffer.set_last_params_partial(currentParams);
                                    on_tool_event?.({
                                        event_type: "ParamsPartial",
                                        tool_id: buffer.get_tool_id(),
                                        tool_name: buffer.get_tool_name(),
                                        params: currentParams,
                                    });
                                }
                            }
                        }
                        // 处理结束原因
                        if (json.choices?.[0]?.finish_reason) {
                            finish_reason = json.choices[0].finish_reason;
                        }
                        // 处理使用统计
                        if (json.usage) {
                            usage = {
                                input_tokens: json.usage.prompt_tokens ?? 0,
                                output_tokens: json.usage.completion_tokens ?? 0,
                                total_tokens: json.usage.total_tokens ?? 0,
                            };
                        }
                    }
                    catch (error) {
                        // 忽略解析错误的行
                        console.warn(`Failed to parse SSE line: ${data}`, error);
                    }
                }
            }
            // 完成后，提取所有工具调用
            for (const buffer of tool_buffers.values()) {
                const tool_call = buffer.to_tool_call();
                if (tool_call) {
                    tool_calls.push(tool_call);
                    on_tool_call?.(tool_call);
                }
            }
            return {
                text: text_chunks.join(""),
                tool_calls,
                finish_reason,
                usage,
            };
        }
        catch (error) {
            console.error(`Stream processing error: ${error}`);
            throw error;
        }
    }
    /**
     * 将 fetch Response 转换为异步迭代器
     */
    async *response_to_stream(response, signal) {
        if (!response.body) {
            throw new Error("Response body is null");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
            while (true) {
                // 检查是否已取消
                if (signal?.aborted) {
                    reader.cancel();
                    throw new Error("Stream processing was cancelled");
                }
                const { done, value } = await reader.read();
                if (done) {
                    if (buffer) {
                        yield buffer;
                    }
                    break;
                }
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const line of lines) {
                    if (line.trim()) {
                        yield line;
                    }
                }
            }
        }
        catch (error) {
            // 如果是取消操作，重新抛出
            if (error instanceof Error && error.message.includes("cancel")) {
                throw error;
            }
            // 其他错误也抛出
            throw error;
        }
        finally {
            reader.releaseLock();
        }
    }
}
//# sourceMappingURL=stream_processor.js.map