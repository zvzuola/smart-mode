import express from "express";
import http from "node:http";
import { WebSocketServer } from "ws";
import { handleAction } from "./actions.js";
const allowCors = (_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (_req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
    }
    next();
};
function toError(message, code = -1) {
    return {
        code,
        message,
        data: null,
    };
}
function parseRpcRequest(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
            return {
                error: { id: "", result: null, error: toError("Parse error: invalid request", -32700) },
            };
        }
        if (typeof parsed.id !== "string" || typeof parsed.action !== "string") {
            return {
                error: { id: String(parsed.id ?? ""), result: null, error: toError("Invalid request") },
            };
        }
        return {
            request: {
                id: parsed.id,
                action: parsed.action,
                params: parsed.params ?? {},
            },
        };
    }
    catch (error) {
        return {
            error: {
                id: "",
                result: null,
                error: toError(`Parse error: ${error instanceof Error ? error.message : String(error)}`, -32700),
            },
        };
    }
}
export async function startServer(ctx, options) {
    const app = express();
    app.use(allowCors);
    app.use(express.json({ limit: "2mb" }));
    app.get("/health", (_req, res) => {
        res.json({
            status: "healthy",
            version: ctx.version,
            uptime_seconds: Math.floor((Date.now() - ctx.startedAt) / 1000),
        });
    });
    app.get("/api/v1/health", (_req, res) => {
        res.json({
            status: "healthy",
            version: ctx.version,
            uptime_seconds: Math.floor((Date.now() - ctx.startedAt) / 1000),
        });
    });
    app.get("/api/v1/info", (_req, res) => {
        res.json({
            name: "V-Coder Server",
            version: ctx.version,
            description: "V-Coder AI Agent Server for HarmonyOS Development (TypeScript)",
            endpoints: [
                { path: "/health", method: "GET", description: "Health check endpoint" },
                { path: "/api/v1/info", method: "GET", description: "API information" },
                { path: "/ws", method: "GET", description: "WebSocket endpoint for real-time communication" },
            ],
        });
    });
    const server = http.createServer(app);
    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
        if (req.url !== "/ws") {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws);
        });
    });
    wss.on("connection", (ws) => {
        console.info(`Received WS connection`);
        const sendEvent = (evt) => {
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify(evt));
            }
        };
        sendEvent({
            event: "connection_established",
            payload: {
                server: "v-coder-ts",
                version: ctx.version,
                timestamp: Math.floor(Date.now() / 1000),
            },
        });
        ws.on("message", async (data) => {
            console.log(`\nReceived WS request data: ${data}`);
            const text = data.toString();
            const parsed = parseRpcRequest(text);
            if (parsed.error) {
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify(parsed.error));
                }
                return;
            }
            const request = parsed.request;
            console.log(`Received RPC request: ${request.action} (id: ${request.id})`);
            let response;
            try {
                const result = await handleAction(request, ctx, sendEvent);
                response = {
                    id: request.id,
                    result,
                    error: null,
                };
            }
            catch (error) {
                response = {
                    id: request.id,
                    result: null,
                    error: toError(error instanceof Error ? error.message : String(error)),
                };
            }
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify(response));
            }
        });
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host, () => resolve());
    });
    console.info(`V-Coder TS server running at http://${options.host}:${options.port}`);
    console.info(`WebSocket endpoint: ws://${options.host}:${options.port}/ws`);
}
//# sourceMappingURL=server.js.map