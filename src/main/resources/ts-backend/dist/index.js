import { AppContext } from "./context.js";
import { startServer } from "./server.js";
import { setGlobalWorkspacePath } from "./context/workspace.js";
import { getGlobalToolRegistry } from "./tools/registry.js";
import { setupFileLogger } from "./logger.js";
import { setUserDevecoHome, findDevecoHome } from "./tools/implementations/deveco_resolver.js";
function parseArgs(argv) {
    const args = {
        host: "127.0.0.1",
        port: 9600,
        logLevel: "info",
    };
    for (let i = 0; i < argv.length; i++) {
        const cur = argv[i];
        const next = argv[i + 1];
        if ((cur === "--port" || cur === "-p") && next) {
            args.port = Number(next);
            i++;
            continue;
        }
        if (cur === "--host" && next) {
            args.host = next;
            i++;
            continue;
        }
        if ((cur === "--workspace" || cur === "-w") && next) {
            args.workspace = next;
            i++;
            continue;
        }
        if (cur === "--log-level" && next) {
            args.logLevel = next;
            i++;
            continue;
        }
        if (cur === "--log-dir" && next) {
            args.logDir = next;
            i++;
            continue;
        }
    }
    return args;
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    // 如果命令行没有指定workspace，从环境变量读取
    const workspace = args.workspace || process.env.WORKSPACE;
    // 尽早初始化日志系统，将 console 输出同时写入文件
    // 日志目录优先级：--log-dir > 环境变量 LOG_DIR > workspace/.vcoder_ts/logs > 当前目录/logs
    const logDir = args.logDir || process.env.LOG_DIR || "./logs";
    setupFileLogger(logDir);
    // 设置全局workspace路径（对标Rust版本）
    if (workspace) {
        setGlobalWorkspacePath(workspace);
    }
    const ctx = new AppContext(workspace);
    await ctx.init();
    // 启用快照功能（对标Rust版本）
    const registry = getGlobalToolRegistry();
    registry.setSnapshotManager(ctx.snapshotManager);
    console.info("✅ 文件快照系统已启用");
    // 从持久化配置或环境变量同步 DevEco Studio 路径
    {
        const cfgValues = ctx.getConfigState().values;
        const hmosObj = cfgValues.hmos;
        const savedPath = typeof hmosObj?.deveco_home === "string" ? hmosObj.deveco_home : "";
        if (savedPath) {
            // 持久化配置有值，直接使用
            process.env.DEVECO_HOME = savedPath;
            setUserDevecoHome(savedPath);
            console.info(`✅ DevEco Studio 路径已加载: ${savedPath} (来源: 持久化配置)`);
        }
        else {
            // 没有持久化配置，通过 findDevecoHome 查找（含 process.env、注册表、自动探测）
            const detected = await findDevecoHome();
            if (detected) {
                process.env.DEVECO_HOME = detected;
                console.info(`✅ DevEco Studio 路径已加载: ${detected} (来源: 自动探测)`);
            }
        }
    }
    await startServer(ctx, {
        host: args.host,
        port: args.port,
    });
}
main().catch((error) => {
    process.stderr.write(`Failed to start server: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map