/**
 * Spec 工作流数据模型
 * 定义状态枚举、阶段定义、工作流上下文、用户操作等
 */
// ============ 工作流状态 ============
export var WorkflowStatus;
(function (WorkflowStatus) {
    WorkflowStatus["IDLE"] = "idle";
    WorkflowStatus["RUNNING"] = "running";
    WorkflowStatus["WAITING_FOR_USER"] = "waiting_for_user";
    WorkflowStatus["COMPLETED"] = "completed";
    WorkflowStatus["FAILED"] = "failed";
    WorkflowStatus["ABORTED"] = "aborted";
})(WorkflowStatus || (WorkflowStatus = {}));
export var PhaseStatus;
(function (PhaseStatus) {
    PhaseStatus["PENDING"] = "pending";
    PhaseStatus["RUNNING"] = "running";
    PhaseStatus["COMPLETED"] = "completed";
    PhaseStatus["FAILED"] = "failed";
    PhaseStatus["SKIPPED"] = "skipped";
})(PhaseStatus || (PhaseStatus = {}));
//# sourceMappingURL=models.js.map