/**
 * Prompt System - System Prompt构建和管理
 * 对标Rust版本的prompt_builder模块
 */
export { PromptBuilder } from "./prompt_builder.js";
import { PromptBuilder } from "./prompt_builder.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// 获取当前模块的目录路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/**
 * 获取嵌入的prompt模板内容
 * 对标Rust版本的get_embedded_prompt函数
 *
 * @param templateName 模板名称（不含扩展名）
 * @returns 模板内容，如果不存在返回undefined
 */
export async function getEmbeddedPrompt(templateName) {
    const fileName = `${templateName}.md`;
    // 多路径回退：插件启动时 setWorkDirectory 为 backend 根目录，优先用 cwd
    const candidates = [
        path.join(process.cwd(), "dist", "prompt", "templates", fileName),
        path.join(__dirname, "templates", fileName),
    ];
    if (process.argv[1]) {
        const entryDir = path.dirname(path.resolve(process.cwd(), process.argv[1]));
        candidates.push(path.join(entryDir, "prompt", "templates", fileName));
    }
    for (const templatePath of candidates) {
        try {
            const content = await fs.readFile(templatePath, "utf-8");
            return content;
        }
        catch {
            // 尝试下一个路径
        }
    }
    console.warn(`Template not found: ${templateName} (tried: ${candidates.join(", ")})`);
    return undefined;
}
/**
 * 构建默认的系统提示词
 * 对标Rust版本的Agent::build_prompt方法
 *
 * @param workspacePath 工作区路径
 * @param templateName 模板名称，默认为"agentic_mode"
 * @returns 完整的系统提示词
 */
export async function buildSystemPrompt(workspacePath, templateName = "agentic_mode") {
    const promptBuilder = new PromptBuilder(workspacePath);
    // 获取模板内容
    const template = await getEmbeddedPrompt(templateName);
    if (!template) {
        throw new Error(`System prompt template not found: ${templateName}`);
    }
    // 使用PromptBuilder根据占位符自动填充内容
    const prompt = await promptBuilder.buildPromptFromTemplate(template);
    return prompt;
}
//# sourceMappingURL=index.js.map