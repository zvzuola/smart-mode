/**
 * 工具执行器
 * 负责执行工具调用
 */
import { getGlobalToolRegistry } from "../tools/registry.js";
/**
 * 工具执行器
 */
export class ToolExecutor {
    registry = getGlobalToolRegistry();
    /**
     * 执行单个工具
     */
    async execute_tool(tool_call, context, on_event) {
        const start_time = Date.now();
        // 发送开始事件（使用 params 而不是 arguments）
        on_event?.({
            event_type: "Started",
            tool_id: tool_call.tool_id,
            tool_name: tool_call.tool_name,
            params: tool_call.arguments,
        });
        try {
            // 获取工具
            const tool = this.registry.get(tool_call.tool_name);
            if (!tool) {
                const error = `Tool not found: ${tool_call.tool_name}`;
                on_event?.({
                    event_type: "Failed",
                    tool_id: tool_call.tool_id,
                    tool_name: tool_call.tool_name,
                    error,
                });
                return {
                    tool_id: tool_call.tool_id,
                    tool_name: tool_call.tool_name,
                    result: { error },
                    result_for_assistant: error,
                    is_error: true,
                    duration_ms: Date.now() - start_time,
                };
            }
            // 执行工具
            console.log(`tool [${tool_call.tool_name}][${tool_call.tool_id}] start`);
            const result = await tool.execute(tool_call, context);
            console.log(`tool [${tool_call.tool_name}][${tool_call.tool_id}] finished`);
            // 发送完成事件
            on_event?.({
                event_type: "Completed",
                tool_id: tool_call.tool_id,
                tool_name: tool_call.tool_name,
                result: result.result,
                duration_ms: result.duration_ms || Date.now() - start_time,
                from_cache: result.from_cache || false,
            });
            return result;
        }
        catch (error) {
            const error_message = error instanceof Error ? error.message : String(error);
            const duration = Date.now() - start_time;
            // 发送失败事件
            on_event?.({
                event_type: "Failed",
                tool_id: tool_call.tool_id,
                tool_name: tool_call.tool_name,
                error: error_message,
            });
            return {
                tool_id: tool_call.tool_id,
                tool_name: tool_call.tool_name,
                result: { error: error_message },
                result_for_assistant: `工具执行失败: ${error_message}`,
                is_error: true,
                duration_ms: duration,
            };
        }
    }
    /**
     * 检查所有工具是否都是并发安全的
     */
    are_all_tools_concurrency_safe(tool_calls) {
        for (const tool_call of tool_calls) {
            const tool = this.registry.get(tool_call.tool_name);
            if (!tool || !tool.is_concurrency_safe()) {
                return false;
            }
        }
        return true;
    }
    /**
     * 批量执行工具
     */
    async execute_tools(tool_calls, context, options = {}, on_event) {
        const { concurrent = true, max_concurrent = 5 } = options;
        // 检查是否应该并行执行
        // 只有当 allow_parallel 为 true 且所有工具都是并发安全时才并行执行
        const all_concurrency_safe = this.are_all_tools_concurrency_safe(tool_calls);
        const should_parallel = concurrent && all_concurrency_safe && tool_calls.length > 1;
        if (!all_concurrency_safe && concurrent) {
            console.info("⚠️ 存在非并发安全的工具，切换为串行执行");
        }
        if (!should_parallel) {
            // 串行执行
            const results = [];
            for (const tool_call of tool_calls) {
                const result = await this.execute_tool(tool_call, context, on_event);
                results.push(result);
            }
            return results;
        }
        // 并发执行（带并发限制）
        const results = new Array(tool_calls.length);
        let nextIndex = 0;
        const workerCount = Math.min(max_concurrent, tool_calls.length);
        const workers = Array.from({ length: workerCount }, async () => {
            while (nextIndex < tool_calls.length) {
                const currentIndex = nextIndex;
                nextIndex += 1;
                const tool_call = tool_calls[currentIndex];
                results[currentIndex] = await this.execute_tool(tool_call, context, on_event);
            }
        });
        await Promise.all(workers);
        return results;
    }
    /**
     * 检查是否有终止轮次的工具
     */
    has_end_turn_tool(tool_calls) {
        const end_turn_tools = this.registry.get_end_turn_tool_names();
        return tool_calls.some((call) => end_turn_tools.includes(call.tool_name));
    }
}
//# sourceMappingURL=tool_executor.js.map