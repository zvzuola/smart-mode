import { randomUUID } from "node:crypto";
export function nowMs() {
    return Date.now();
}
export function nowSec() {
    return Math.floor(Date.now() / 1000);
}
export function genId(prefix) {
    return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
export function extractRequestBody(params) {
    if (!params || typeof params !== "object") {
        return {};
    }
    const request = params.request;
    if (request && typeof request === "object" && !Array.isArray(request)) {
        return request;
    }
    return params;
}
export function pickParam(body, keys) {
    for (const key of keys) {
        if (key in body) {
            return body[key];
        }
    }
    return undefined;
}
export function requireParam(body, keys, name) {
    const value = pickParam(body, keys);
    if (value === undefined || value === null || value === "") {
        throw new Error(`${name} required`);
    }
    return value;
}
export function setByPath(target, path, value) {
    const parts = path.split(".").filter(Boolean);
    if (parts.length === 0) {
        throw new Error("path required");
    }
    let cur = target;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        const next = cur[key];
        if (!next || typeof next !== "object" || Array.isArray(next)) {
            cur[key] = {};
        }
        cur = cur[key];
    }
    cur[parts[parts.length - 1]] = value;
}
export function getByPath(target, path) {
    if (!path) {
        return target;
    }
    const parts = path.split(".").filter(Boolean);
    let cur = target;
    for (const part of parts) {
        if (!cur || typeof cur !== "object" || !(part in cur)) {
            throw new Error(`Config path not found: ${path}`);
        }
        cur = cur[part];
    }
    return cur;
}
export function deleteByPath(target, path) {
    const parts = path.split(".").filter(Boolean);
    if (parts.length === 0) {
        return;
    }
    let cur = target;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        const next = cur[key];
        if (!next || typeof next !== "object" || Array.isArray(next)) {
            return;
        }
        cur = next;
    }
    delete cur[parts[parts.length - 1]];
}
//# sourceMappingURL=utils.js.map