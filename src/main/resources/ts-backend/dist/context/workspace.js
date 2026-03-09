/**
 * 全局workspace管理系统
 * 对标Rust版本的 infrastructure/context/manager.rs
 */
import path from "node:path";
/**
 * 全局workspace路径
 */
let globalWorkspacePath;
/**
 * 设置全局workspace路径
 * 对应Rust的 set_workspace_path
 */
export function setGlobalWorkspacePath(workspacePath) {
    if (workspacePath) {
        // 标准化路径
        globalWorkspacePath = path.resolve(workspacePath);
        console.info(`✅ 全局workspace路径已设置: ${globalWorkspacePath}`);
    }
    else {
        globalWorkspacePath = undefined;
        console.info("✅ 全局workspace路径已清除");
    }
}
/**
 * 获取全局workspace路径
 * 对应Rust的 get_workspace_path
 */
export function getGlobalWorkspacePath() {
    return globalWorkspacePath;
}
/**
 * 解析路径（相对路径转绝对路径）
 * 如果是相对路径且有全局workspace，则相对于workspace解析
 */
export function resolvePath(filePath) {
    if (path.isAbsolute(filePath)) {
        return filePath;
    }
    const workspace = getGlobalWorkspacePath();
    if (workspace) {
        return path.resolve(workspace, filePath);
    }
    return path.resolve(filePath);
}
/**
 * 检查路径是否在workspace内
 */
export function isInWorkspace(filePath) {
    const workspace = getGlobalWorkspacePath();
    if (!workspace) {
        return false;
    }
    const absolutePath = path.resolve(filePath);
    const normalizedWorkspace = path.resolve(workspace);
    return absolutePath.startsWith(normalizedWorkspace);
}
//# sourceMappingURL=workspace.js.map