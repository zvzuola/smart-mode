/**
 * DevEco Studio 路径解析工具
 *
 * 负责自动查找 DevEco Studio 安装路径，供编译工具和配置接口共同使用。
 * 优先级: 用户配置 > 进程环境变量 > 系统级环境变量(注册表/shell) > 自动探测常见路径
 * 支持平台: Windows / macOS
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const execAsync = promisify(exec);
/** 用户在设置面板中配置的 DevEco Studio 路径 */
let userConfigDevecoHome;
/**
 * 设置用户配置的 DevEco Studio 路径（由 actions.ts 在配置变更时调用）
 */
export function setUserDevecoHome(devecoHome) {
    userConfigDevecoHome = devecoHome || undefined;
    if (devecoHome) {
        console.info(`[DevEcoResolver] 用户配置 DevEco Home: ${devecoHome}`);
    }
}
/**
 * 获取当前用户配置的 DevEco Studio 路径
 */
export function getUserDevecoHome() {
    return userConfigDevecoHome;
}
/**
 * 验证路径是否存在
 */
async function pathExists(p) {
    try {
        await fs.access(p);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * 尝试从系统级环境变量中读取 DEVECO_HOME（绕过进程继承问题）
 * - Windows: 从注册表读取
 * - macOS: 从 launchctl 或 shell profile 读取
 */
async function readSystemEnvDevecoHome() {
    try {
        if (process.platform === "win32") {
            // Windows: 从注册表读取系统级环境变量
            const { stdout } = await execAsync('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v DEVECO_HOME', { timeout: 5000 });
            const match = stdout.match(/DEVECO_HOME\s+REG_\w+\s+(.+)/);
            if (match) {
                return match[1].trim();
            }
        }
        else if (process.platform === "darwin") {
            // macOS: 尝试 launchctl（GUI 应用可见的环境变量）
            try {
                const { stdout } = await execAsync("launchctl getenv DEVECO_HOME", { timeout: 3000 });
                const val = stdout.trim();
                if (val)
                    return val;
            }
            catch {
                // launchctl 未设置，继续
            }
            // macOS: 启动一个 login shell 读取 ~/.zshrc / ~/.bash_profile 中导出的变量
            try {
                const shell = process.env.SHELL || "/bin/zsh";
                const { stdout } = await execAsync(`${shell} -l -c 'echo "$DEVECO_HOME"'`, { timeout: 5000 });
                const val = stdout.trim();
                if (val)
                    return val;
            }
            catch {
                // shell 读取失败，忽略
            }
        }
    }
    catch {
        // 读取失败，忽略
    }
    return undefined;
}
/**
 * 自动探测 DevEco Studio 常见安装路径
 */
async function detectCommonPaths() {
    const home = os.homedir();
    if (process.platform === "win32") {
        const candidates = [
            "C:\\Program Files\\DevEco Studio",
            "C:\\Program Files (x86)\\DevEco Studio",
            "D:\\APP\\DevEco Studio",
            "D:\\Program Files\\Huawei\\DevEco Studio",
        ];
        // 用户主目录
        const userProfile = process.env.USERPROFILE || home;
        if (userProfile) {
            candidates.push(path.join(userProfile, "DevEco Studio"));
        }
        for (const p of candidates) {
            if (await pathExists(p) && await pathExists(path.join(p, "tools", "node"))) {
                return p;
            }
        }
    }
    else if (process.platform === "darwin") {
        const candidates = [
            "/Applications/DevEco Studio.app/Contents",
            path.join(home, "Applications", "DevEco Studio.app", "Contents"),
            "/Applications/DevEco-Studio.app/Contents",
            path.join(home, "Applications", "DevEco-Studio.app", "Contents"),
        ];
        for (const p of candidates) {
            // macOS 下 DevEco Studio 是 .app bundle，实际工具在 Contents 下
            if (await pathExists(p) && await pathExists(path.join(p, "tools", "node"))) {
                return p;
            }
        }
        // 也检查不带 /Contents 的路径（有些版本直接解压到目录）
        const extraCandidates = [
            "/Applications/DevEco Studio",
            path.join(home, "Applications", "DevEco Studio"),
        ];
        for (const p of extraCandidates) {
            if (await pathExists(p) && await pathExists(path.join(p, "tools", "node"))) {
                return p;
            }
        }
    }
    return undefined;
}
/**
 * 自动查找 DevEco Studio 安装路径
 * 优先级: 用户配置 > 进程环境变量 > 系统级环境变量 > 自动探测常见路径
 */
export async function findDevecoHome() {
    // 1. 优先使用用户在设置面板中配置的路径
    if (userConfigDevecoHome) {
        if (await pathExists(userConfigDevecoHome)) {
            console.info(`[DevEcoResolver] 使用用户配置 DevEco Home: ${userConfigDevecoHome}`);
            return userConfigDevecoHome;
        }
        console.warn(`[DevEcoResolver] 用户配置的 DevEco Home 路径不存在: ${userConfigDevecoHome}`);
    }
    // 2. 使用进程环境变量
    const envHome = process.env.DEVECO_HOME;
    if (envHome) {
        if (await pathExists(envHome)) {
            console.info(`[DevEcoResolver] 使用环境变量 DEVECO_HOME: ${envHome}`);
            return envHome;
        }
        console.warn(`[DevEcoResolver] 环境变量 DEVECO_HOME 路径不存在: ${envHome}`);
    }
    // 3. 尝试从系统级环境变量读取（Windows 注册表 / macOS launchctl+shell）
    if (!envHome) {
        const sysEnv = await readSystemEnvDevecoHome();
        if (sysEnv) {
            if (await pathExists(sysEnv)) {
                console.info(`[DevEcoResolver] 从系统级环境变量读取 DEVECO_HOME: ${sysEnv}`);
                return sysEnv;
            }
            console.warn(`[DevEcoResolver] 系统级环境变量 DEVECO_HOME 路径不存在: ${sysEnv}`);
        }
    }
    // 4. 自动探测常见安装路径
    const detected = await detectCommonPaths();
    if (detected) {
        console.info(`[DevEcoResolver] 自动探测到 DevEco Studio: ${detected}`);
        return detected;
    }
    return undefined;
}
//# sourceMappingURL=deveco_resolver.js.map