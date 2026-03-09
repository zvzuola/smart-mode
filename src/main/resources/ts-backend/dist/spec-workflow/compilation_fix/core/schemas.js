export class CompilationFixValidationError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
function assertObject(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new CompilationFixValidationError("INVALID_INPUT", "input must be an object");
    }
}
export function parseCompilationFixInput(input) {
    assertObject(input);
    const unsupportedKeys = [
        "error_info",
        "need_specify_error_info",
        "max_strategy_fix_rounds",
        "batch_size",
        "enable_concurrent_fix",
        "task_timeout_sec",
    ];
    const providedUnsupportedKeys = unsupportedKeys.filter((key) => input[key] !== undefined);
    if (providedUnsupportedKeys.length > 0) {
        throw new CompilationFixValidationError("INVALID_INPUT", `unsupported input fields: ${providedUnsupportedKeys.join(", ")}`);
    }
    const projectAbsPath = input.project_abs_path;
    if (typeof projectAbsPath !== "string" || projectAbsPath.trim().length === 0) {
        throw new CompilationFixValidationError("INVALID_PATH", "project_abs_path is required and must be a non-empty string");
    }
    const parsed = {
        project_abs_path: projectAbsPath,
    };
    return parsed;
}
//# sourceMappingURL=schemas.js.map