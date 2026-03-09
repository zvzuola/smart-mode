export class TaskEventEmitter {
    taskId;
    emit;
    common;
    seq = 0;
    constructor(taskId, emit, common) {
        this.taskId = taskId;
        this.emit = emit;
        this.common = common;
    }
    wrapAgenticEmitter() {
        return (eventData) => {
            const payload = { ...(eventData.payload ?? {}) };
            const rawRoundId = typeof payload.roundId === "string" ? payload.roundId : undefined;
            if (rawRoundId && !rawRoundId.startsWith("cf-task:")) {
                payload.roundId = `cf-task:${encodeURIComponent(this.taskId)}:${rawRoundId}`;
            }
            this.emit({
                ...eventData,
                payload: {
                    ...payload,
                    taskId: this.taskId,
                },
            });
            // IDE 桥接兜底：text-chunk 同步镜像到 spec-workflow task-status
            // 避免高频 agentic 事件在桥接层丢失导致分支面板正文缺失
            if (eventData.event === "agentic://text-chunk" && typeof payload.text === "string" && payload.text.length > 0) {
                const statusPayload = {
                    ...this.basePayload(),
                    status: "running",
                    progress: undefined,
                    message: payload.text,
                };
                this.emit({
                    event: "spec-workflow://compilation-fix-task-status",
                    payload: statusPayload,
                });
            }
        };
    }
    emitTaskStarted(input) {
        const payload = {
            ...this.basePayload(),
            taskType: input.taskType,
            taskName: input.taskName,
            description: input.description,
            errorCount: input.errorCount,
            affectedFiles: input.affectedFiles,
        };
        this.emit({
            event: "spec-workflow://compilation-fix-task-started",
            payload: payload,
        });
    }
    emitTaskStatus(input) {
        const payload = {
            ...this.basePayload(),
            status: input.status,
            progress: input.progress,
            message: input.message,
        };
        this.emit({
            event: "spec-workflow://compilation-fix-task-status",
            payload: payload,
        });
    }
    emitTaskCompleted(input) {
        const payload = {
            ...this.basePayload(),
            taskType: input.taskType,
            success: input.success,
            fixedCount: input.fixedCount,
            remainingCount: input.remainingCount,
            durationMs: input.durationMs,
            errorMessage: input.errorMessage,
        };
        this.emit({
            event: "spec-workflow://compilation-fix-task-completed",
            payload: payload,
        });
    }
    basePayload() {
        this.seq += 1;
        return {
            sessionId: this.common.sessionId,
            turnId: this.common.turnId,
            phaseId: this.common.phaseId,
            taskId: this.taskId,
            roundNum: this.common.roundNum,
            batchIndex: this.common.batchIndex,
            totalBatches: this.common.totalBatches,
            seq: this.seq,
            timestamp: Date.now(),
        };
    }
}
//# sourceMappingURL=task_event_emitter.js.map