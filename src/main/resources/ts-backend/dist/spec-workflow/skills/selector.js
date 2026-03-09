/**
 * Skill 选择器
 * 调用 LLM 根据用户需求从候选列表中选择最匹配的 skills
 */
import { getEmbeddedPrompt } from "../../prompt/index.js";
/**
 * 将 skill 列表格式化为 LLM 可读的候选摘要
 */
function formatSkillCandidates(skills) {
    return skills
        .map((s, i) => {
        const tags = s.tags.length > 0 ? `  Tags: ${s.tags.join(", ")}` : "";
        return `${i + 1}. **${s.name}**\n  Description: ${s.description}${tags}`;
    })
        .join("\n\n");
}
/**
 * 从 LLM 响应中提取 JSON 数组
 */
function extractJsonArray(text) {
    const cleaned = text.trim();
    // Try direct parse
    try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed))
            return parsed.filter((s) => typeof s === "string");
    }
    catch {
        // fall through
    }
    // Try extracting from markdown code block
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
        try {
            const parsed = JSON.parse(codeBlockMatch[1].trim());
            if (Array.isArray(parsed))
                return parsed.filter((s) => typeof s === "string");
        }
        catch {
            // fall through
        }
    }
    // Try finding array pattern in text
    const arrayMatch = cleaned.match(/\[[\s\S]*?\]/);
    if (arrayMatch) {
        try {
            const parsed = JSON.parse(arrayMatch[0]);
            if (Array.isArray(parsed))
                return parsed.filter((s) => typeof s === "string");
        }
        catch {
            // fall through
        }
    }
    console.warn("[SkillSelector] Failed to parse LLM response as JSON array:", cleaned.slice(0, 200));
    return [];
}
export class SkillSelector {
    /**
     * 调用 LLM 从候选 skill 列表中选择与用户需求匹配的 skills
     *
     * 使用一次轻量级非流式 LLM 调用。
     * 如果调用失败或无候选，返回空数组（不阻塞工作流）。
     */
    async selectSkills(userQuery, availableSkills, modelConfig) {
        if (availableSkills.length === 0) {
            console.info("[SkillSelector] No available skills, skipping selection");
            return [];
        }
        try {
            let template = await getEmbeddedPrompt("spec_skill_selection");
            if (!template) {
                console.warn("[SkillSelector] Skill selection prompt template not found, skipping");
                return [];
            }
            const candidatesText = formatSkillCandidates(availableSkills);
            template = template.replace("{SKILL_CANDIDATES}", candidatesText);
            template = template.replace("{USER_QUERY}", userQuery);
            const selectedNames = await this.callLLM(template, modelConfig);
            const nameSet = new Set(selectedNames.map((n) => n.toLowerCase()));
            const selected = availableSkills.filter((s) => nameSet.has(s.name.toLowerCase()));
            console.info(`[SkillSelector] Selected ${selected.length}/${availableSkills.length} skills: [${selected.map((s) => s.name).join(", ")}]`);
            return selected;
        }
        catch (error) {
            console.error("[SkillSelector] Skill selection failed, continuing without skills:", error);
            return [];
        }
    }
    async callLLM(prompt, modelConfig) {
        const { base_url, model_name, api_key, custom_headers } = modelConfig;
        if (!base_url || !model_name) {
            throw new Error("AI model configuration is incomplete for skill selection");
        }
        const url = base_url.endsWith("/chat/completions")
            ? base_url
            : `${base_url.replace(/\/$/, "")}/chat/completions`;
        const payload = {
            model: model_name,
            messages: [
                { role: "system", content: prompt },
            ],
            temperature: 0.3,
            stream: false,
            max_tokens: 512,
        };
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
            const errorText = await response.text();
            throw new Error(`Skill selection LLM request failed: ${response.status} ${errorText}`);
        }
        const data = (await response.json());
        const content = data.choices?.[0]?.message?.content ?? "";
        return extractJsonArray(content);
    }
}
//# sourceMappingURL=selector.js.map