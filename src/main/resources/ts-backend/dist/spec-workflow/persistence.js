/**
 * 工作流状态持久化
 * 将 WorkflowContext 序列化为 JSON 存储到 .vcoder_ts/workflow_states/
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { WorkflowStatus } from "./models.js";
/**
 * 获取工作流状态存储目录
 */
function getStateDir(workspacePath) {
    return path.join(workspacePath, ".vcoder_ts", "workflow_states");
}
/**
 * 获取指定 session 的状态文件路径
 */
function getStatePath(workspacePath, sessionId) {
    return path.join(getStateDir(workspacePath), `${sessionId}.json`);
}
/**
 * 保存工作流状态
 */
export async function saveWorkflowState(workspacePath, context, workflowStatus = WorkflowStatus.WAITING_FOR_USER, currentPhaseIndex = 0) {
    console.info(`[Persistence] saveWorkflowState | sessionId=${context.sessionId}, status=${workflowStatus}, phaseIndex=${currentPhaseIndex}, phases=${context.executionHistory.join(',')}`);
    try {
        const dir = getStateDir(workspacePath);
        await fs.mkdir(dir, { recursive: true });
        const serialized = {
            sessionId: context.sessionId,
            turnId: context.turnId,
            userQuery: context.userQuery,
            workspacePath: context.workspacePath,
            specDir: context.specDir,
            executionHistory: [...context.executionHistory],
            phaseResults: Object.fromEntries(context.phaseResults),
            feedbackHistory: Object.fromEntries(context.feedbackHistory),
            savedAt: new Date().toISOString(),
            workflowStatus,
            currentPhaseIndex,
        };
        const filePath = getStatePath(workspacePath, context.sessionId);
        await fs.writeFile(filePath, JSON.stringify(serialized, null, 2), "utf8");
        console.info(`[Persistence] saveWorkflowState OK | path=${filePath}`);
    }
    catch (error) {
        console.error(`[Persistence] saveWorkflowState FAIL | sessionId=${context.sessionId}, error=${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * 加载工作流状态
 */
export async function loadWorkflowState(workspacePath, sessionId) {
    console.info(`[Persistence] loadWorkflowState | sessionId=${sessionId}`);
    const filePath = getStatePath(workspacePath, sessionId);
    try {
        const raw = await fs.readFile(filePath, "utf8");
        const data = JSON.parse(raw);
        // Migrate legacy data: remove compilation_fix phase (merged into execution)
        const migratedHistory = data.executionHistory.filter((id) => id !== "compilation_fix");
        const migratedResults = { ...data.phaseResults };
        delete migratedResults["compilation_fix"];
        const migratedFeedback = { ...(data.feedbackHistory || {}) };
        delete migratedFeedback["compilation_fix"];
        // Adjust currentPhaseIndex: old compilation_fix was order=4, old summary was order=5.
        // New summary is order=4. If index pointed at the removed phase or beyond, clamp it.
        const NEW_PHASE_COUNT = 5;
        let migratedPhaseIndex = data.currentPhaseIndex ?? (migratedHistory.length - 1);
        if (migratedPhaseIndex >= NEW_PHASE_COUNT) {
            migratedPhaseIndex = NEW_PHASE_COUNT - 1;
        }
        const context = {
            sessionId: data.sessionId,
            turnId: data.turnId,
            userQuery: data.userQuery,
            workspacePath: data.workspacePath,
            specDir: data.specDir,
            executionHistory: migratedHistory,
            phaseResults: new Map(Object.entries(migratedResults)),
            feedbackHistory: new Map(Object.entries(migratedFeedback)),
            selectedSkills: [],
        };
        console.info(`[Persistence] loadWorkflowState OK | sessionId=${sessionId}, phases=[${migratedHistory.join(',')}], phaseIndex=${migratedPhaseIndex}`);
        return {
            context,
            workflowStatus: data.workflowStatus ?? WorkflowStatus.WAITING_FOR_USER,
            currentPhaseIndex: migratedPhaseIndex,
        };
    }
    catch (error) {
        console.warn(`[Persistence] loadWorkflowState FAIL (file may not exist) | sessionId=${sessionId}, error=${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}
/**
 * 删除工作流状态
 */
export async function deleteWorkflowState(workspacePath, sessionId) {
    const filePath = getStatePath(workspacePath, sessionId);
    try {
        await fs.unlink(filePath);
        console.info(`[Persistence] Deleted workflow state: ${filePath}`);
    }
    catch {
        // 文件不存在，忽略
    }
}
/**
 * 列出所有持久化的工作流状态
 */
export async function listWorkflowStates(workspacePath) {
    const dir = getStateDir(workspacePath);
    try {
        const files = await fs.readdir(dir);
        return files
            .filter((f) => f.endsWith(".json"))
            .map((f) => f.replace(".json", ""));
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=persistence.js.map