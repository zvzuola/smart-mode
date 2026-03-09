/**
 * 对话轮次持久化
 * 将前端发送的完整 DialogTurnData（含 phaseId、ModelRound 详情）
 * 存储到 .vcoder_ts/dialog_turns/{sessionId}/{turnId}.json
 */
import { promises as fs } from "node:fs";
import path from "node:path";
/** 编译修复分支面板快照文件名，与主聊天区同一目录，加载对话轮次时排除 */
export const COMPILATION_FIX_SNAPSHOT_FILENAME = "compilation_fix_snapshot.json";
function getDialogTurnsDir(workspacePath, sessionId) {
    return path.join(workspacePath, ".vcoder_ts", "dialog_turns", sessionId);
}
function getTurnFilePath(workspacePath, sessionId, turnId) {
    return path.join(getDialogTurnsDir(workspacePath, sessionId), `${turnId}.json`);
}
function getCompilationFixSnapshotPath(workspacePath, sessionId) {
    return path.join(getDialogTurnsDir(workspacePath, sessionId), COMPILATION_FIX_SNAPSHOT_FILENAME);
}
/**
 * 保存单个对话轮次到文件
 */
export async function saveDialogTurnToFile(workspacePath, sessionId, turnData) {
    const dir = getDialogTurnsDir(workspacePath, sessionId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = getTurnFilePath(workspacePath, sessionId, turnData.turnId);
    await fs.writeFile(filePath, JSON.stringify(turnData, null, 2), "utf8");
    console.info(`[DialogTurnPersistence] saved turn ${turnData.turnId} for session ${sessionId}`);
}
/**
 * 加载指定 session 的所有对话轮次，按 turnIndex 排序
 */
export async function loadDialogTurns(workspacePath, sessionId) {
    const dir = getDialogTurnsDir(workspacePath, sessionId);
    try {
        const files = await fs.readdir(dir);
        const jsonFiles = files.filter((f) => f.endsWith(".json") && f !== COMPILATION_FIX_SNAPSHOT_FILENAME);
        const turns = [];
        for (const file of jsonFiles) {
            try {
                const raw = await fs.readFile(path.join(dir, file), "utf8");
                turns.push(JSON.parse(raw));
            }
            catch {
                console.warn(`[DialogTurnPersistence] failed to read ${file}, skipping`);
            }
        }
        turns.sort((a, b) => a.turnIndex - b.turnIndex);
        console.info(`[DialogTurnPersistence] loaded ${turns.length} turns for session ${sessionId}`);
        return turns;
    }
    catch {
        return [];
    }
}
/**
 * 保存编译修复分支面板快照（与主聊天区同一目录，参考 dialog turn 持久化）
 */
export async function saveCompilationFixSnapshot(workspacePath, sessionId, snapshot) {
    const dir = getDialogTurnsDir(workspacePath, sessionId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = getCompilationFixSnapshotPath(workspacePath, sessionId);
    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
    console.info(`[DialogTurnPersistence] saved compilation_fix_snapshot for session ${sessionId}`);
}
/**
 * 加载编译修复分支面板快照
 */
export async function loadCompilationFixSnapshot(workspacePath, sessionId) {
    const filePath = getCompilationFixSnapshotPath(workspacePath, sessionId);
    try {
        const raw = await fs.readFile(filePath, "utf8");
        const data = JSON.parse(raw);
        const branches = data?.compilationFixBranches;
        if (branches && Array.isArray(branches.order) && branches.order.length > 0) {
            return data;
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * 删除指定 session 的所有对话轮次文件
 */
export async function deleteDialogTurns(workspacePath, sessionId) {
    const dir = getDialogTurnsDir(workspacePath, sessionId);
    try {
        await fs.rm(dir, { recursive: true, force: true });
        console.info(`[DialogTurnPersistence] deleted turns for session ${sessionId}`);
    }
    catch {
        // directory doesn't exist, ignore
    }
}
//# sourceMappingURL=dialog_turn_persistence.js.map