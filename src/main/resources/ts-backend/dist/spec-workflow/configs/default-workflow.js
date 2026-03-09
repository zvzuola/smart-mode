/**
 * 默认 5 阶段线性工作流定义
 * specification → design → planning → execution → summary
 * 编译修复已内嵌为 execution 阶段的尾部子步骤
 */
/**
 * 创建默认的 5 阶段工作流定义
 */
export function createDefaultWorkflow() {
    return [
        {
            id: "specification",
            name: "需求分析",
            description: "分析用户需求，读取项目代码理解上下文，输出结构化需求文档",
            order: 0,
            allowedTools: ["ReadFile", "LS", "Grep", "Glob"],
            promptTemplate: "spec_specification",
            artifactFileName: "requirements.md",
        },
        {
            id: "design",
            name: "架构设计",
            description: "基于需求文档，设计技术架构、模块划分、接口定义",
            order: 1,
            allowedTools: ["ReadFile", "LS", "Grep", "Glob"],
            promptTemplate: "spec_design",
            artifactFileName: "design.md",
        },
        {
            id: "planning",
            name: "任务规划",
            description: "基于架构设计，拆分为可执行的开发任务列表",
            order: 2,
            allowedTools: ["ReadFile", "LS", "Grep", "Glob"],
            promptTemplate: "spec_planning",
            artifactFileName: "planning.md",
        },
        {
            id: "execution",
            name: "代码执行",
            description: "按任务列表逐一执行代码编写和修改，完成后自动进行编译验证与修复",
            order: 3,
            allowedTools: ["ReadFile", "LS", "Grep", "Glob", "Shell", "Write", "Edit", "Delete"],
            promptTemplate: "spec_execution",
            artifactFileName: "execution_report.md",
        },
        {
            id: "summary",
            name: "总结报告",
            description: "汇总所有阶段成果，生成最终报告",
            order: 4,
            allowedTools: ["ReadFile", "LS", "Grep", "Glob", "Write"],
            promptTemplate: "spec_summary",
            artifactFileName: "summary.md",
        },
    ];
}
//# sourceMappingURL=default-workflow.js.map