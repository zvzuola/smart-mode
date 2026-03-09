/**
 * System Prompt Builder - 对标Rust版本的PromptBuilder
 *
 * 功能：
 * 1. 提供环境信息 (ENV_INFO)
 * 2. 提供项目文件布局 (PROJECT_LAYOUT)
 * 3. 加载AI规则 (RULES)
 * 4. 加载AI记忆点 (MEMORIES)
 * 5. 获取用户语言偏好 (LANGUAGE_PREFERENCE)
 * 6. 从模板构建完整的system prompt
 */
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
/**
 * 占位符常量
 */
const PLACEHOLDER_ENV_INFO = "{ENV_INFO}";
const PLACEHOLDER_PROJECT_LAYOUT = "{PROJECT_LAYOUT}";
const PLACEHOLDER_RULES = "{RULES}";
const PLACEHOLDER_MEMORIES = "{MEMORIES}";
const PLACEHOLDER_LANGUAGE_PREFERENCE = "{LANGUAGE_PREFERENCE}";
/**
 * PromptBuilder类 - 构建系统提示词
 */
export class PromptBuilder {
    workspacePath;
    fileTreeMaxEntries;
    constructor(workspacePath) {
        this.workspacePath = workspacePath.replace(/\\/g, "/");
        this.fileTreeMaxEntries = 200;
    }
    /**
     * 提供完整的环境信息
     */
    getEnvInfo() {
        // 获取操作系统信息
        const osName = process.platform;
        const osFamily = os.type();
        const arch = process.arch;
        // 获取当前时间
        const now = new Date();
        const currentDate = now.toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
        });
        return `# Environment Information
<environment_details>
- Current Working Directory: ${this.workspacePath}
- Operating System: ${osName} (${osFamily})
- Architecture: ${arch}
- Current Date: ${currentDate}
</environment_details>

`;
    }
    /**
     * 获取工作区文件列表
     */
    async getProjectLayout() {
        try {
            const { hitLimit, formattedFilesList } = await this.getFormattedFilesList(this.workspacePath, this.fileTreeMaxEntries);
            let projectLayout = "# Workspace Layout\n<project_layout>\n";
            if (hitLimit) {
                projectLayout += `Below is a snapshot of the current workspace's file structure (showing up to ${this.fileTreeMaxEntries} entries).\n\n`;
            }
            else {
                projectLayout += "Below is a snapshot of the current workspace's file structure.\n\n";
            }
            projectLayout += formattedFilesList;
            projectLayout += "\n</project_layout>\n\n";
            return projectLayout;
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return `# Workspace Layout\n<project_layout>\nError listing directory: ${errorMsg}\n</project_layout>\n\n`;
        }
    }
    /**
     * 获取格式化的文件列表（递归）
     */
    async getFormattedFilesList(dirPath, maxEntries) {
        const lines = [];
        let count = 0;
        const maxCount = maxEntries;
        const traverse = async (currentPath, depth) => {
            if (count >= maxCount) {
                return true; // 已达到限制
            }
            try {
                const entries = await fs.readdir(currentPath, { withFileTypes: true });
                // 排序：目录优先，然后按名称排序
                entries.sort((a, b) => {
                    if (a.isDirectory() !== b.isDirectory()) {
                        return a.isDirectory() ? -1 : 1;
                    }
                    return a.name.localeCompare(b.name);
                });
                for (const entry of entries) {
                    if (count >= maxCount) {
                        return true;
                    }
                    // 跳过隐藏文件和常见的忽略目录
                    if (entry.name.startsWith("."))
                        continue;
                    if (["node_modules", "dist", "build", "target", ".git"].includes(entry.name)) {
                        continue;
                    }
                    const indent = "  ".repeat(depth);
                    const prefix = entry.isDirectory() ? "📁 " : "📄 ";
                    lines.push(`${indent}${prefix}${entry.name}`);
                    count++;
                    if (entry.isDirectory()) {
                        const fullPath = path.join(currentPath, entry.name);
                        const hitLimit = await traverse(fullPath, depth + 1);
                        if (hitLimit) {
                            return true;
                        }
                    }
                }
            }
            catch (error) {
                // 忽略无法读取的目录
            }
            return false;
        };
        const hitLimit = await traverse(dirPath, 0);
        return {
            hitLimit,
            formattedFilesList: lines.join("\n"),
        };
    }
    /**
     * 从磁盘加载AI记忆点并格式化为prompt
     *
     * 注意：TypeScript版本暂未实现AI Memory Manager
     * 这是一个占位实现，返回空字符串
     */
    async loadAIMemories() {
        // TODO: 实现AI Memory Manager
        // 对标Rust版本的 AIMemoryManager::get_memories_for_prompt()
        return undefined;
    }
    /**
     * 从磁盘加载AI规则并格式化为prompt
     *
     * 注意：TypeScript版本暂未实现AI Rules Service
     * 这是一个占位实现，返回空字符串
     */
    async loadAIRules() {
        // TODO: 实现AI Rules Service
        // 对标Rust版本的 AIRulesService::build_system_prompt()
        return undefined;
    }
    /**
     * 获取用户语言偏好指令
     *
     * 从全局配置读取 app.language，生成简单的语言指令
     * 如果无法读取配置，返回空字符串
     */
    async getLanguagePreference() {
        // TODO: 从全局配置读取语言设置
        // 对标Rust版本的 GlobalConfigManager::get_config("app.language")
        // 临时实现：从环境变量读取，默认中文
        const languageCode = process.env.APP_LANGUAGE || "zh-CN";
        return this.formatLanguageInstruction(languageCode);
    }
    /**
     * 根据语言代码格式化语言指令
     */
    formatLanguageInstruction(langCode) {
        const languageMap = {
            "zh-CN": "**Simplified Chinese** (中文)",
            "zh-SG": "**Simplified Chinese** (中文)",
            "en-US": "**English**",
            "en-GB": "**English**",
            "en-CA": "**English**",
            "en-AU": "**English**",
            "en-NZ": "**English**",
            "en-IE": "**English**",
            "en-ZA": "**English**",
            "en-IN": "**English**",
            "zh-TW": "**Traditional Chinese** (繁體中文)",
            "zh-HK": "**Traditional Chinese** (繁體中文)",
            "ja-JP": "**Japanese** (日本語)",
            "ko-KR": "**Korean** (한국어)",
            "es-ES": "**Spanish** (Español)",
            "es-MX": "**Spanish** (Español)",
            "es-AR": "**Spanish** (Español)",
            "es-CO": "**Spanish** (Español)",
            "es-CL": "**Spanish** (Español)",
            "fr-FR": "**French** (Français)",
            "fr-CA": "**French** (Français)",
            "fr-BE": "**French** (Français)",
            "fr-CH": "**French** (Français)",
            "de-DE": "**German** (Deutsch)",
            "de-AT": "**German** (Deutsch)",
            "de-CH": "**German** (Deutsch)",
            "it-IT": "**Italian** (Italiano)",
            "it-CH": "**Italian** (Italiano)",
            "pt-BR": "**Portuguese** (Português)",
            "pt-PT": "**Portuguese** (Português)",
            "ru-RU": "**Russian** (Русский)",
            "ar-SA": "**Arabic** (العربية)",
            "ar-EG": "**Arabic** (العربية)",
            "ar-AE": "**Arabic** (العربية)",
            "hi-IN": "**Hindi** (हिन्दी)",
            "th-TH": "**Thai** (ไทย)",
            "vi-VN": "**Vietnamese** (Tiếng Việt)",
            "id-ID": "**Indonesian** (Bahasa Indonesia)",
            "ms-MY": "**Malay** (Bahasa Melayu)",
            "tr-TR": "**Turkish** (Türkçe)",
            "pl-PL": "**Polish** (Polski)",
            "nl-NL": "**Dutch** (Nederlands)",
            "nl-BE": "**Dutch** (Nederlands)",
            "sv-SE": "**Swedish** (Svenska)",
            "nb-NO": "**Norwegian** (Norsk)",
            "nn-NO": "**Norwegian** (Norsk)",
            "da-DK": "**Danish** (Dansk)",
            "fi-FI": "**Finnish** (Suomi)",
            "el-GR": "**Greek** (Ελληνικά)",
            "he-IL": "**Hebrew** (עברית)",
            "cs-CZ": "**Czech** (Čeština)",
            "ro-RO": "**Romanian** (Română)",
            "hu-HU": "**Hungarian** (Magyar)",
            "uk-UA": "**Ukrainian** (Українська)",
        };
        const language = languageMap[langCode];
        if (!language) {
            // 未知语言代码，不添加指令
            console.debug(`Unknown language code: ${langCode}`);
            return "";
        }
        return `# Language Preference
You MUST respond in ${language} regardless of the user's input language. This is the system language setting and should be followed unless the user explicitly specifies a different language. This is crucial for smooth communication and user experience.
All generated documents, reports, and artifacts MUST also be written in ${language}. Code comments should use ${language} where appropriate, but variable names, function names, and code syntax remain in English.
`;
    }
    /**
     * 从模板构建prompt，根据占位符自动填充内容
     *
     * 支持的占位符：
     * - `{LANGUAGE_PREFERENCE}` - 用户语言偏好（从全局配置读取）
     * - `{ENV_INFO}` - 环境信息
     * - `{PROJECT_LAYOUT}` - 项目文件布局
     * - `{RULES}` - AI规则
     * - `{MEMORIES}` - AI记忆点
     *
     * 如果模板中没有某个占位符，则不会添加对应的内容
     */
    async buildPromptFromTemplate(template) {
        let result = template;
        // 替换 {LANGUAGE_PREFERENCE}
        if (result.includes(PLACEHOLDER_LANGUAGE_PREFERENCE)) {
            const languagePreference = await this.getLanguagePreference();
            result = result.replace(PLACEHOLDER_LANGUAGE_PREFERENCE, languagePreference);
        }
        // 替换 {ENV_INFO}
        if (result.includes(PLACEHOLDER_ENV_INFO)) {
            const envInfo = this.getEnvInfo();
            result = result.replace(PLACEHOLDER_ENV_INFO, envInfo);
        }
        // 替换 {PROJECT_LAYOUT}
        if (result.includes(PLACEHOLDER_PROJECT_LAYOUT)) {
            const projectLayout = await this.getProjectLayout();
            result = result.replace(PLACEHOLDER_PROJECT_LAYOUT, projectLayout);
        }
        // 替换 {RULES}
        if (result.includes(PLACEHOLDER_RULES)) {
            const rules = (await this.loadAIRules()) || "";
            result = result.replace(PLACEHOLDER_RULES, rules);
        }
        // 替换 {MEMORIES}
        if (result.includes(PLACEHOLDER_MEMORIES)) {
            const memories = (await this.loadAIMemories()) || "";
            result = result.replace(PLACEHOLDER_MEMORIES, memories);
        }
        return result.trim();
    }
}
//# sourceMappingURL=prompt_builder.js.map