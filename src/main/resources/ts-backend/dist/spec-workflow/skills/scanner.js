/**
 * Skill 扫描与加载模块
 * 扫描项目级和用户级 skill 目录，解析 SKILL.md frontmatter，加载内容
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const ALL_PHASES = [
    "specification",
    "design",
    "planning",
    "execution",
    "summary",
];
/**
 * 获取用户级 skill 目录（跨平台）
 */
function getUserSkillsDir() {
    const platform = process.platform;
    if (platform === "win32") {
        return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "V-Coder", "skills");
    }
    if (platform === "darwin") {
        return path.join(os.homedir(), "Library", "Application Support", "V-Coder", "skills");
    }
    return path.join(os.homedir(), ".config", "V-Coder", "skills");
}
/**
 * 解析 YAML frontmatter（轻量实现，不引入外部依赖）
 *
 * 支持格式:
 *   name: value
 *   tags: [a, b, c]
 *   applies_to: [specification, design]
 */
function parseFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
        return { frontmatter: {}, body: raw };
    }
    const yamlBlock = match[1];
    const body = match[2];
    const fm = {};
    for (const line of yamlBlock.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#"))
            continue;
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx < 0)
            continue;
        const key = trimmed.slice(0, colonIdx).trim();
        let value = trimmed.slice(colonIdx + 1).trim();
        if (key === "name") {
            fm.name = value;
        }
        else if (key === "description") {
            fm.description = value;
        }
        else if (key === "tags" || key === "applies_to") {
            fm[key] = parseYamlArray(value);
        }
    }
    return { frontmatter: fm, body };
}
function parseYamlArray(value) {
    const bracketMatch = value.match(/^\[(.*)\]$/);
    if (bracketMatch) {
        return bracketMatch[1]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}
export class SkillScanner {
    /**
     * 扫描所有可用的 skills（项目级 + 用户级）
     */
    async scanSkills(workspacePath) {
        const projectSkillsDir = path.join(workspacePath, ".vcoder", "skills");
        const userSkillsDir = getUserSkillsDir();
        const [projectSkills, userSkills] = await Promise.all([
            this.scanDirectory(projectSkillsDir),
            this.scanDirectory(userSkillsDir),
        ]);
        // 项目级优先（同名时覆盖用户级）
        const skillMap = new Map();
        for (const skill of userSkills) {
            skillMap.set(skill.name, skill);
        }
        for (const skill of projectSkills) {
            skillMap.set(skill.name, skill);
        }
        const result = Array.from(skillMap.values());
        console.info(`[SkillScanner] Found ${result.length} skills (project: ${projectSkills.length}, user: ${userSkills.length})`);
        return result;
    }
    /**
     * 加载 skill 的完整内容
     */
    async loadSkillContent(skill) {
        const raw = await fs.readFile(skill.filePath, "utf-8");
        const { body } = parseFrontmatter(raw);
        return {
            ...skill,
            content: body.trim(),
        };
    }
    /**
     * 批量加载多个 skill 的完整内容
     */
    async loadSkillContents(skills) {
        return Promise.all(skills.map((s) => this.loadSkillContent(s)));
    }
    async scanDirectory(dirPath) {
        const skills = [];
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                const skillFilePath = path.join(dirPath, entry.name, "SKILL.md");
                try {
                    const raw = await fs.readFile(skillFilePath, "utf-8");
                    const { frontmatter } = parseFrontmatter(raw);
                    const appliesTo = (frontmatter.applies_to ?? []).filter((p) => ALL_PHASES.includes(p));
                    skills.push({
                        name: frontmatter.name || entry.name,
                        description: frontmatter.description || "",
                        tags: frontmatter.tags || [],
                        appliesTo: appliesTo.length > 0 ? appliesTo : ALL_PHASES,
                        filePath: skillFilePath,
                    });
                }
                catch {
                    // SKILL.md not found or unreadable — skip
                }
            }
        }
        catch {
            // Directory doesn't exist — that's fine
        }
        return skills;
    }
}
//# sourceMappingURL=scanner.js.map