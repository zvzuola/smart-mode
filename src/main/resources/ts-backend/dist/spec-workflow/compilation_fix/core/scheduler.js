import { CompilationFixExecutionMode } from "../config.js";
import { FixTaskType, } from "./models.js";
function errorCountFromPayload(payload) {
    return payload.reduce((sum, item) => sum + item.count, 0);
}
export class CompilationFixScheduler {
    config;
    runtime;
    classifier;
    constructor(config, runtime, classifier) {
        this.config = config;
        this.runtime = runtime;
        this.classifier = classifier;
    }
    async execute(projectAbsPath, fileCategoryGroups, codeCategoryGroups, roundNum) {
        console.info(`[ConcurrentFixScheduler] [Round ${roundNum}] 开始执行分批修复`);
        console.info(`[ConcurrentFixScheduler] file_groups: ${fileCategoryGroups.length}, code_groups: ${codeCategoryGroups.length}`);
        const fileTasks = this.buildFileGroupTasks(fileCategoryGroups, roundNum);
        const codeTasks = this.buildCodeGroupTasks(codeCategoryGroups, roundNum);
        const plan = this.planBatches(fileTasks, codeTasks, roundNum);
        const result = await this.runBatches(projectAbsPath, plan.batches, roundNum);
        return { ...result, mode: plan.mode, termination_reasons: [] };
    }
    buildFileGroupTasks(fileCategoryGroups, roundNum) {
        const tasks = fileCategoryGroups.map((group, index) => ({
            task_id: `file_group_${index + 1}_round_${roundNum}`,
            category_id: `file_group_${index + 1}_round_${roundNum}`,
            task_type: FixTaskType.FILE_GROUP,
            payload: group,
            affected_files: new Set(group.map((item) => item.error_file_path)),
            priority: 1,
        }));
        console.info(`[ConcurrentFixScheduler] 构建了 ${tasks.length} 个 file_group tasks`);
        return tasks;
    }
    buildCodeGroupTasks(codeCategoryGroups, roundNum) {
        const tasks = codeCategoryGroups.map((group, index) => {
            const affectedFiles = new Set();
            let hasUnknownFile = false;
            for (const category of group) {
                for (const err of category.errors) {
                    if (err.file && err.file !== "unknown") {
                        affectedFiles.add(err.file);
                    }
                    else {
                        hasUnknownFile = true;
                    }
                }
            }
            return {
                task_id: `code_group_${index + 1}_round_${roundNum}`,
                category_id: `code_group_${index + 1}_round_${roundNum}`,
                task_type: FixTaskType.CODE_GROUP,
                payload: group,
                affected_files: hasUnknownFile ? null : affectedFiles,
                priority: 0,
            };
        });
        for (const task of tasks) {
            if (task.affected_files === null) {
                console.warn(`[ConcurrentFixScheduler] Task ${task.task_id} 有错误缺少 file 字段，affected_files 设为 null`);
            }
        }
        console.info(`[ConcurrentFixScheduler] 构建了 ${tasks.length} 个 code_group tasks`);
        return tasks;
    }
    verifyFileIsolation(fileTasks, codeTasks) {
        const fileSet = new Set();
        for (const task of fileTasks) {
            if (!task.affected_files) {
                console.warn(`file_group 任务 ${task.task_id} 的 affected_files 为空，验证失败`);
                return false;
            }
            for (const file of task.affected_files) {
                fileSet.add(file);
            }
        }
        for (const task of codeTasks) {
            if (!task.affected_files) {
                continue;
            }
            for (const file of task.affected_files) {
                if (fileSet.has(file)) {
                    console.warn(`文件隔离验证失败：code_group ${task.task_id} 与 file_group 存在重叠文件: ${file}`);
                    return false;
                }
            }
        }
        console.info(`[ConcurrentFixScheduler] 文件隔离验证通过：file_group(${fileSet.size} 文件) 与 code_group 无重叠`);
        return true;
    }
    partitionIntoBatches(tasks) {
        const sortedTasks = [...tasks].sort((a, b) => {
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            const ac = errorCountFromPayload(a.payload);
            const bc = errorCountFromPayload(b.payload);
            return bc - ac;
        });
        const batches = [];
        for (const task of sortedTasks) {
            if (task.affected_files === null) {
                console.warn(`[ConcurrentFixScheduler] Task ${task.task_id} 的 affected_files 不可信，单独放置到批次 ${batches.length + 1}`);
                batches.push([task]);
                continue;
            }
            let placed = false;
            for (const batch of batches) {
                if (this.hasBatchConflict(task, batch)) {
                    continue;
                }
                batch.push(task);
                placed = true;
                break;
            }
            if (!placed) {
                batches.push([task]);
            }
        }
        console.info(`[ConcurrentFixScheduler] 冲突检测完成，将 ${tasks.length} 个任务划分为 ${batches.length} 个批次`);
        for (let i = 0; i < batches.length; i += 1) {
            const ids = batches[i].map((item) => item.task_id).join(", ");
            console.info(`[ConcurrentFixScheduler] 批次 ${i + 1}: ${batches[i].length} 个任务 - [${ids}]`);
        }
        return batches;
    }
    hasBatchConflict(task, batch) {
        if (task.affected_files === null) {
            return true;
        }
        for (const existing of batch) {
            if (existing.affected_files === null) {
                return true;
            }
            for (const file of task.affected_files) {
                if (existing.affected_files.has(file)) {
                    return true;
                }
            }
        }
        return false;
    }
    planBatches(fileTasks, codeTasks, roundNum) {
        let fileConcurrent = false;
        let codeConcurrent = false;
        if (this.config.mode === CompilationFixExecutionMode.MIXED_PARALLEL) {
            if (fileTasks.length > 0 && codeTasks.length > 0) {
                const mixedEnabled = this.verifyFileIsolation(fileTasks, codeTasks);
                if (mixedEnabled) {
                    console.info(`[ConcurrentFixScheduler] [Round ${roundNum}] 启用 mixed 批次计划`);
                    const mixedBatches = this.partitionIntoBatches([...fileTasks, ...codeTasks]).map((tasks, index) => ({
                        tasks,
                        validate_before_batch: index > 0,
                    }));
                    return { mode: "mixed", batches: mixedBatches };
                }
                console.warn(`[ConcurrentFixScheduler] [Round ${roundNum}] mixed 批次隔离校验失败，回退为分类型批次计划`);
            }
            else {
                console.info(`[ConcurrentFixScheduler] [Round ${roundNum}] mixed 模式下缺少 file/code 任务，回退为分类型批次计划`);
            }
            fileConcurrent = true;
            codeConcurrent = true;
        }
        else if (this.config.mode === CompilationFixExecutionMode.FILE_PARALLEL) {
            fileConcurrent = true;
        }
        else if (this.config.mode === CompilationFixExecutionMode.CODE_PARALLEL) {
            codeConcurrent = true;
        }
        else if (this.config.mode !== CompilationFixExecutionMode.SERIAL) {
            console.warn(`[ConcurrentFixScheduler] [Round ${roundNum}] 未知 mode=${String(this.config.mode)}，回退为串行分批计划`);
        }
        console.info(`[ConcurrentFixScheduler] [Round ${roundNum}] 使用分类型批次计划：mode=${this.config.mode}, file_concurrent=${fileConcurrent}, code_concurrent=${codeConcurrent}`);
        const fileBatches = this.buildBatchesByConcurrency(fileTasks, fileConcurrent);
        const codeBatches = this.buildBatchesByConcurrency(codeTasks, codeConcurrent);
        const batches = [];
        for (let index = 0; index < fileBatches.length; index += 1) {
            batches.push({
                tasks: fileBatches[index],
                validate_before_batch: !fileConcurrent && index > 0,
            });
        }
        for (const batch of codeBatches) {
            batches.push({
                tasks: batch,
                validate_before_batch: true,
            });
        }
        console.info(`[ConcurrentFixScheduler] [Round ${roundNum}] 批次计划完成：file_batches=${fileBatches.length}, code_batches=${codeBatches.length}, total=${batches.length}`);
        return { mode: "serial", batches };
    }
    buildBatchesByConcurrency(tasks, concurrent) {
        if (tasks.length === 0) {
            return [];
        }
        if (concurrent) {
            return this.partitionIntoBatches(tasks);
        }
        return tasks.map((task) => [task]);
    }
    async runBatches(projectAbsPath, batches, roundNum) {
        const fixResults = [];
        const batchSummaries = [];
        let remainingErrors = "";
        for (let i = 0; i < batches.length; i += 1) {
            const batchPlan = batches[i];
            const originalBatch = batchPlan.tasks;
            let batch = originalBatch;
            console.info(`[ConcurrentFixScheduler] 开始执行批次 ${i + 1}/${batches.length}，包含 ${batch.length} 个任务`);
            if (batchPlan.validate_before_batch) {
                remainingErrors = (await this.runtime.compile(projectAbsPath)).errors_text;
                if (!this.classifier.hasErrors(remainingErrors)) {
                    console.info(`[ConcurrentFixScheduler] 批次 ${i + 1} 执行前检测到错误已全部修复，提前结束`);
                    break;
                }
                const filtered = this.filterBatchByRemainingErrors(batch, remainingErrors);
                batch = filtered.batch;
                if (filtered.validationResults.length > 0) {
                    fixResults.push(...filtered.validationResults);
                }
            }
            if (batch.length === 0) {
                const skippedSummaries = originalBatch.map((task) => this.toSkippedTaskSummary(task));
                batchSummaries.push(this.createBatchSummary(roundNum, i + 1, batches.length, skippedSummaries));
                console.info(`[ConcurrentFixScheduler] 批次 ${i + 1} 的所有错误已被修复，跳过`);
                continue;
            }
            const reports = await this.executeBatchWithLimit(projectAbsPath, batch, roundNum, this.config.maxConcurrentTasks, i + 1, batches.length);
            fixResults.push(...reports);
            const taskSummaries = batch.map((task, index) => this.toTaskSummary(task, reports[index]));
            batchSummaries.push(this.createBatchSummary(roundNum, i + 1, batches.length, taskSummaries));
            console.info(`[ConcurrentFixScheduler] 批次 ${i + 1}/${batches.length} 执行完成`);
        }
        remainingErrors = (await this.runtime.compile(projectAbsPath)).errors_text;
        this.attachRemainingErrors(fixResults, remainingErrors);
        return { remaining_errors_text: remainingErrors, fix_results: fixResults, batch_summaries: batchSummaries };
    }
    createBatchSummary(roundNum, batchIndex, totalBatches, tasks) {
        return {
            round_num: roundNum,
            batch_index: batchIndex,
            total_batches: totalBatches,
            tasks,
        };
    }
    toTaskSummary(task, result) {
        let status = "success";
        if (result.final_status.includes("异常") || result.final_status.includes("失败")) {
            status = "failed";
        }
        else if (result.fixed_count === 0) {
            status = "no_fix";
        }
        return {
            task_id: task.task_id,
            task_type: task.task_type,
            status,
            initial_count: result.initial_count,
            fixed_count: result.fixed_count,
            remaining_count: result.remaining_count,
            message: result.final_status,
        };
    }
    toSkippedTaskSummary(task) {
        const initialCount = errorCountFromPayload(task.payload);
        return {
            task_id: task.task_id,
            task_type: task.task_type,
            status: "skipped",
            initial_count: initialCount,
            fixed_count: 0,
            remaining_count: initialCount,
            message: "Skipped: already fixed by previous batches",
        };
    }
    filterBatchByRemainingErrors(batch, remainingErrors) {
        const validationResults = [];
        const filtered = batch.filter((task) => {
            if (task.task_type === FixTaskType.FILE_GROUP) {
                return true;
            }
            const payload = task.payload;
            const updatedPayload = [];
            let shouldRunTask = false;
            for (const category of payload) {
                console.info(`[ConcurrentFixScheduler] 验证 code_category: task=${task.task_id}, code=${category.error_code}, count=${category.count}`);
                const validated = this.classifier.validateCodeCategoryErrors(category, remainingErrors);
                if (validated.validationResult) {
                    validationResults.push(validated.validationResult);
                    console.info(`[ConcurrentFixScheduler] 验证结果: code=${category.error_code}, fixed=${validated.validationResult.fixed_count}, ` +
                        `remaining=${validated.validationResult.remaining_count}, status=${validated.validationResult.final_status}`);
                }
                if (validated.updatedCategory) {
                    updatedPayload.push(validated.updatedCategory);
                    shouldRunTask = true;
                }
            }
            if (shouldRunTask) {
                task.payload = updatedPayload;
                console.info(`[ConcurrentFixScheduler] task=${task.task_id} 验证后保留 ${updatedPayload.length} 个 code_category，继续执行`);
                return true;
            }
            console.info(`任务 ${task.task_id} 的错误已被前面批次修复，跳过执行`);
            return false;
        });
        return { batch: filtered, validationResults };
    }
    async executeTask(projectAbsPath, task, roundNum, batchIndex = 1, totalBatches = 1) {
        let report;
        console.info(`[ConcurrentFixScheduler] 开始执行任务: ${task.task_id}`);
        try {
            report = await this.runtime.run_fix_task(projectAbsPath, task, roundNum, this.config.taskTimeoutSec, undefined, batchIndex, totalBatches);
        }
        catch (error) {
            console.error(`[ConcurrentFixScheduler] 任务 ${task.task_id} 执行异常: ${error instanceof Error ? error.message : String(error)}`);
            report = {
                task_id: task.task_id,
                task_type: task.task_type,
                success: false,
                fixed_count: 0,
                error_message: error instanceof Error ? error.message : String(error),
            };
        }
        const initialCount = errorCountFromPayload(task.payload);
        const fixedCount = report.success ? Math.max(0, Math.min(report.fixed_count, initialCount)) : 0;
        const remainingCount = initialCount - fixedCount;
        const finalStatus = !report.success ? "执行异常" : fixedCount >= initialCount ? "全部修复" : fixedCount > 0 ? "部分修复" : "未修复";
        console.info(`[ConcurrentFixScheduler] 任务 ${task.task_id} 执行${report.success ? "成功" : "失败"}，初始 ${initialCount}，修复 ${fixedCount}，剩余 ${remainingCount}`);
        return {
            code_category_errors: task.task_type === FixTaskType.CODE_GROUP ? task.payload : [],
            file_category_errors: task.task_type === FixTaskType.FILE_GROUP ? task.payload : [],
            initial_count: initialCount,
            fixed_count: fixedCount,
            remaining_count: remainingCount,
            modifications: report.error_message ? [report.error_message] : [],
            final_status: finalStatus,
            all_remaining_errors: "",
        };
    }
    attachRemainingErrors(results, remainingErrors) {
        for (const result of results) {
            result.all_remaining_errors = remainingErrors;
        }
    }
    async executeBatchWithLimit(projectAbsPath, batch, roundNum, limit, batchIndex = 1, totalBatches = 1) {
        if (batch.length <= 1 || limit <= 1) {
            console.info("[ConcurrentFixScheduler] 当前批次使用串行执行");
            const serialResults = [];
            for (const task of batch) {
                serialResults.push(await this.executeTask(projectAbsPath, task, roundNum, batchIndex, totalBatches));
            }
            return serialResults;
        }
        const cappedLimit = Math.max(1, Math.min(limit, batch.length));
        console.info(`[ConcurrentFixScheduler] 当前批次并发执行：任务数 ${batch.length}，并发上限 ${cappedLimit}`);
        const results = new Array(batch.length);
        let nextIndex = 0;
        const worker = async () => {
            while (true) {
                const current = nextIndex;
                nextIndex += 1;
                if (current >= batch.length) {
                    return;
                }
                results[current] = await this.executeTask(projectAbsPath, batch[current], roundNum, batchIndex, totalBatches);
            }
        };
        const workers = Array.from({ length: cappedLimit }, () => worker());
        await Promise.all(workers);
        return results;
    }
}
//# sourceMappingURL=scheduler.js.map