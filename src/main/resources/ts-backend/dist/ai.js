function toOpenAIMessages(history, userInput) {
    const mapped = history
        .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content }));
    mapped.push({ role: "user", content: userInput });
    return mapped;
}
export async function generateAssistantText(input) {
    const chunks = [];
    for await (const chunk of generateAssistantChunks(input)) {
        chunks.push(chunk);
    }
    return chunks.join("");
}
export async function* generateAssistantChunks(input) {
    const { modelConfig, userInput, history, signal } = input;
    if (!modelConfig || !modelConfig.base_url || !modelConfig.model_name) {
        yield `当前未配置可用模型，请先在配置中心设置 ai.models 与 ai.default_models.primary。你刚刚输入的是：${userInput}`;
        return;
    }
    const isDeepSeekModel = modelConfig.id === "deepseek-chat" ||
        modelConfig.model_name?.toLowerCase().includes("deepseek") ||
        modelConfig.base_url?.toLowerCase().includes("deepseek");
    const apiKey = modelConfig.api_key ||
        (isDeepSeekModel ? process.env.DEEPSEEK_API_KEY : "") ||
        process.env.OPENAI_API_KEY ||
        process.env.VCODER_API_KEY ||
        "";
    const url = modelConfig.base_url.endsWith("/chat/completions")
        ? modelConfig.base_url
        : `${modelConfig.base_url.replace(/\/$/, "")}/chat/completions`;
    const payload = {
        model: modelConfig.model_name,
        messages: toOpenAIMessages(history, userInput),
        temperature: 0.7,
        stream: true,
    };
    if (isDeepSeekModel) {
        payload.max_tokens = Math.min(Math.max(1, modelConfig.max_tokens ?? 1024), 8192);
    }
    // 合并自定义请求体（覆盖默认字段）
    if (modelConfig.custom_request_body) {
        try {
            const extra = JSON.parse(modelConfig.custom_request_body);
            if (extra && typeof extra === "object" && !Array.isArray(extra)) {
                Object.assign(payload, extra);
            }
        }
        catch (e) {
            console.warn(`Failed to parse custom_request_body: ${e}`);
        }
    }
    const { messages: _msgs, ...payloadForLog } = payload;
    console.log(`[ai] request payload (without messages): ${JSON.stringify(payloadForLog)}`);
    const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
        : AbortSignal.timeout(45000);
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            ...(modelConfig.custom_headers ?? {}),
        },
        body: JSON.stringify(payload),
        signal: requestSignal,
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`AI request failed: ${res.status} ${txt}`);
    }
    if (!res.body) {
        throw new Error("AI response stream unavailable");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let emitted = false;
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:"))
                continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]")
                continue;
            if (!data)
                continue;
            try {
                const json = JSON.parse(data);
                const delta = json?.choices?.[0]?.delta?.content;
                if (typeof delta === "string" && delta.length > 0) {
                    emitted = true;
                    yield delta;
                }
            }
            catch {
                // ignore partial malformed lines
            }
        }
    }
    if (!emitted) {
        // 一些 OpenAI 兼容端可能忽略 stream=true，回退读取完整 JSON
        try {
            const fallbackRes = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                    ...(modelConfig.custom_headers ?? {}),
                },
                body: JSON.stringify({ ...payload, stream: false }),
                signal: requestSignal,
            });
            if (!fallbackRes.ok) {
                const txt = await fallbackRes.text();
                throw new Error(`AI request failed: ${fallbackRes.status} ${txt}`);
            }
            const fallbackJson = (await fallbackRes.json());
            const text = fallbackJson?.choices?.[0]?.message?.content;
            if (typeof text === "string" && text.length > 0) {
                yield text;
                return;
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes("aborted") || msg.includes("timeout")) {
                throw new Error("AI request timeout (45s)");
            }
            throw new Error(`AI response has empty content: ${msg}`);
        }
        throw new Error("AI response has empty content");
    }
}
//# sourceMappingURL=ai.js.map