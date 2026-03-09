/**
 * Console 日志文件输出
 * 拦截所有 console.log/info/warn/error/debug，同时写入到日志文件中
 */
import fs from "node:fs";
import path from "node:path";
let logStream = null;
let initialized = false;
// 保存原始 console 方法
const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
};
/**
 * 格式化日志参数为字符串
 */
function formatArgs(args) {
    return args
        .map((arg) => {
        if (typeof arg === "string")
            return arg;
        if (arg instanceof Error)
            return `${arg.message}\n${arg.stack}`;
        try {
            return JSON.stringify(arg, null, 2);
        }
        catch {
            return String(arg);
        }
    })
        .join(" ");
}
/**
 * 获取当前时间的 ISO 格式字符串
 */
function timestamp() {
    return new Date().toISOString();
}
/**
 * 写入一行日志到文件
 */
function writeToFile(level, args) {
    if (!logStream || logStream.destroyed)
        return;
    const line = `${timestamp()} [${level.toUpperCase().padEnd(5)}] ${formatArgs(args)}\n`;
    try {
        logStream.write(line);
    }
    catch {
        // 写入失败时静默忽略，避免死循环
    }
}
/**
 * 初始化日志系统，将 console 输出同时写入到文件
 * @param logDir 日志文件所在目录（默认为进程工作目录）
 */
export function setupFileLogger(logDir) {
    if (initialized)
        return;
    const dir = logDir || process.cwd();
    // 确保日志目录存在
    try {
        fs.mkdirSync(dir, { recursive: true });
    }
    catch {
        originalConsole.warn(`[Logger] 无法创建日志目录: ${dir}`);
        return;
    }
    // 日志文件名: vcoder_server_YYYYMMDD.log
    const now = new Date();
    const dateStr = `${now.getFullYear()}` +
        `${String(now.getMonth() + 1).padStart(2, "0")}` +
        `${String(now.getDate()).padStart(2, "0")}`;
    const logFilePath = path.join(dir, `vcoder_server_${dateStr}.log`);
    // 以追加模式打开日志文件
    try {
        logStream = fs.createWriteStream(logFilePath, { flags: "a", encoding: "utf8" });
        logStream.on("error", (err) => {
            originalConsole.error(`[Logger] 日志文件写入错误:`, err.message);
            logStream = null;
        });
    }
    catch (err) {
        originalConsole.warn(`[Logger] 无法打开日志文件: ${logFilePath}`, err);
        return;
    }
    // 拦截 console 方法
    console.log = (...args) => {
        originalConsole.log(...args);
        writeToFile("LOG", args);
    };
    console.info = (...args) => {
        originalConsole.info(...args);
        writeToFile("INFO", args);
    };
    console.warn = (...args) => {
        originalConsole.warn(...args);
        writeToFile("WARN", args);
    };
    console.error = (...args) => {
        originalConsole.error(...args);
        writeToFile("ERROR", args);
    };
    console.debug = (...args) => {
        originalConsole.debug(...args);
        writeToFile("DEBUG", args);
    };
    initialized = true;
    // 写入启动标记
    const separator = "=".repeat(80);
    logStream.write(`\n${separator}\n`);
    logStream.write(`${timestamp()} [INFO ] 📝 日志系统已启动，日志文件: ${logFilePath}\n`);
    logStream.write(`${separator}\n`);
    originalConsole.info(`📝 日志文件: ${logFilePath}`);
    // 进程退出时关闭流
    const cleanup = () => {
        if (logStream && !logStream.destroyed) {
            logStream.write(`${timestamp()} [INFO ] 🛑 服务关闭，日志系统停止\n`);
            logStream.end();
            logStream = null;
        }
    };
    process.on("exit", cleanup);
    process.on("SIGINT", () => {
        cleanup();
        process.exit(0);
    });
    process.on("SIGTERM", () => {
        cleanup();
        process.exit(0);
    });
}
//# sourceMappingURL=logger.js.map