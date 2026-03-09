/**
 * 文件快照系统 - 类型定义
 *
 * 对标Rust版本：
 * backend/vcoder/crates/core/src/service/snapshot/types.rs
 */
/**
 * 操作类型
 */
export var OperationType;
(function (OperationType) {
    /** 创建新文件 */
    OperationType["Create"] = "create";
    /** 修改现有文件 */
    OperationType["Modify"] = "modify";
    /** 删除文件 */
    OperationType["Delete"] = "delete";
    /** 重命名文件 */
    OperationType["Rename"] = "rename";
})(OperationType || (OperationType = {}));
//# sourceMappingURL=types.js.map