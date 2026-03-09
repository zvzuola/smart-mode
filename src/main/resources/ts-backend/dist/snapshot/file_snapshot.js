/**
 * 文件快照存储系统
 *
 * 对标Rust版本：
 * backend/vcoder/crates/core/src/service/snapshot/snapshot_system.rs
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { promisify } from "node:util";
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
/**
 * 文件快照存储
 */
export class FileSnapshotStorage {
    workspaceDir;
    snapshotDir;
    hashDir;
    metadataDir;
    constructor(workspaceDir) {
        this.workspaceDir = workspaceDir;
        this.snapshotDir = path.join(workspaceDir, ".vcoder_ts", "snapshots");
        this.hashDir = path.join(this.snapshotDir, "by_hash");
        this.metadataDir = path.join(this.snapshotDir, "metadata");
    }
    /**
     * 初始化存储目录
     */
    async initialize() {
        await fs.mkdir(this.hashDir, { recursive: true });
        await fs.mkdir(this.metadataDir, { recursive: true });
        console.info("✅ [FileSnapshotStorage] 初始化完成");
    }
    /**
     * 创建文件快照
     *
     * @param filePath 文件路径
     * @param snapshotId 快照ID（如果不提供则自动生成）
     * @returns 快照对象
     */
    async createSnapshot(filePath, snapshotId) {
        // 1. 读取文件内容
        const content = await fs.readFile(filePath);
        // 2. 计算内容哈希
        const contentHash = this.calculateHash(content);
        // 3. 获取文件元数据
        const stats = await fs.stat(filePath);
        const metadata = {
            size: stats.size,
            mtime: stats.mtimeMs,
            mode: stats.mode,
            encoding: "utf-8", // 简化处理
        };
        // 4. 压缩内容
        const compressed = await gzip(content);
        // 5. 创建快照对象
        const snapshot = {
            snapshotId: snapshotId || this.generateSnapshotId(),
            filePath,
            contentHash,
            content: compressed,
            compressed: true,
            timestamp: Date.now(),
            metadata,
        };
        // 6. 保存快照
        await this.saveSnapshot(snapshot);
        console.info(`✅ [FileSnapshotStorage] 创建快照: ${snapshot.snapshotId} for ${filePath}`);
        return snapshot;
    }
    /**
     * 保存快照
     */
    async saveSnapshot(snapshot) {
        // 1. 保存内容（按哈希，实现去重）
        const hashPath = path.join(this.hashDir, `${snapshot.contentHash}.snap`);
        // 检查是否已存在（去重）
        try {
            await fs.access(hashPath);
            console.info(`📋 [FileSnapshotStorage] 快照内容已存在（去重）: ${snapshot.contentHash}`);
        }
        catch {
            // 不存在，保存
            await fs.writeFile(hashPath, snapshot.content);
        }
        // 2. 保存元数据
        const metadataPath = path.join(this.metadataDir, `${snapshot.snapshotId}.json`);
        const metadataJson = {
            snapshotId: snapshot.snapshotId,
            filePath: snapshot.filePath,
            contentHash: snapshot.contentHash,
            compressed: snapshot.compressed,
            timestamp: snapshot.timestamp,
            metadata: snapshot.metadata,
        };
        await fs.writeFile(metadataPath, JSON.stringify(metadataJson, null, 2), "utf-8");
    }
    /**
     * 加载快照
     */
    async loadSnapshot(snapshotId) {
        try {
            // 1. 读取元数据
            const metadataPath = path.join(this.metadataDir, `${snapshotId}.json`);
            const metadataJson = await fs.readFile(metadataPath, "utf-8");
            const metadata = JSON.parse(metadataJson);
            // 2. 读取内容
            const hashPath = path.join(this.hashDir, `${metadata.contentHash}.snap`);
            const content = await fs.readFile(hashPath);
            return {
                snapshotId: metadata.snapshotId,
                filePath: metadata.filePath,
                contentHash: metadata.contentHash,
                content,
                compressed: metadata.compressed,
                timestamp: metadata.timestamp,
                metadata: metadata.metadata,
            };
        }
        catch (error) {
            console.warn(`⚠️ [FileSnapshotStorage] 加载快照失败: ${snapshotId}`, error);
            return null;
        }
    }
    /**
     * 恢复文件从快照
     *
     * @param snapshotId 快照ID
     * @param targetPath 目标路径（如果不提供则使用快照中的路径）
     */
    async restoreFile(snapshotId, targetPath) {
        const snapshot = await this.loadSnapshot(snapshotId);
        if (!snapshot) {
            throw new Error(`快照不存在: ${snapshotId}`);
        }
        const restorePath = targetPath || snapshot.filePath;
        // 1. 解压内容
        let content = snapshot.content;
        if (snapshot.compressed) {
            content = await gunzip(snapshot.content);
        }
        // 2. 确保目录存在
        const dir = path.dirname(restorePath);
        await fs.mkdir(dir, { recursive: true });
        // 3. 写入文件
        await fs.writeFile(restorePath, content);
        // 4. 恢复元数据（权限等）
        if (snapshot.metadata.mode) {
            try {
                await fs.chmod(restorePath, snapshot.metadata.mode);
            }
            catch (error) {
                console.warn(`⚠️ [FileSnapshotStorage] 恢复文件权限失败: ${restorePath}`, error);
            }
        }
        console.info(`✅ [FileSnapshotStorage] 恢复文件: ${restorePath} from ${snapshotId}`);
    }
    /**
     * 删除快照
     */
    async deleteSnapshot(snapshotId) {
        try {
            // 1. 读取元数据获取contentHash
            const metadataPath = path.join(this.metadataDir, `${snapshotId}.json`);
            const metadataJson = await fs.readFile(metadataPath, "utf-8");
            const metadata = JSON.parse(metadataJson);
            // 2. 删除元数据
            await fs.unlink(metadataPath);
            // 3. 检查是否有其他快照使用同一个hash
            const allMetadata = await this.getAllMetadata();
            const hashInUse = allMetadata.some((m) => m.snapshotId !== snapshotId && m.contentHash === metadata.contentHash);
            // 4. 如果没有其他快照使用，删除内容文件
            if (!hashInUse) {
                const hashPath = path.join(this.hashDir, `${metadata.contentHash}.snap`);
                await fs.unlink(hashPath);
                console.info(`🗑️ [FileSnapshotStorage] 删除快照内容: ${metadata.contentHash}`);
            }
            console.info(`✅ [FileSnapshotStorage] 删除快照: ${snapshotId}`);
        }
        catch (error) {
            console.warn(`⚠️ [FileSnapshotStorage] 删除快照失败: ${snapshotId}`, error);
        }
    }
    /**
     * 获取所有元数据
     */
    async getAllMetadata() {
        try {
            const files = await fs.readdir(this.metadataDir);
            const metadata = [];
            for (const file of files) {
                if (file.endsWith(".json")) {
                    const filePath = path.join(this.metadataDir, file);
                    const content = await fs.readFile(filePath, "utf-8");
                    metadata.push(JSON.parse(content));
                }
            }
            return metadata;
        }
        catch {
            return [];
        }
    }
    /**
     * 清理过期快照
     *
     * @param beforeTimestamp 清理此时间之前的快照
     */
    async cleanupOldSnapshots(beforeTimestamp) {
        const allMetadata = await this.getAllMetadata();
        let cleanedCount = 0;
        for (const metadata of allMetadata) {
            if (metadata.timestamp < beforeTimestamp) {
                await this.deleteSnapshot(metadata.snapshotId);
                cleanedCount++;
            }
        }
        console.info(`✅ [FileSnapshotStorage] 清理过期快照: ${cleanedCount} 个`);
        return cleanedCount;
    }
    /**
     * 获取存储统计信息
     */
    async getStorageStats() {
        const allMetadata = await this.getAllMetadata();
        // 计算总存储大小
        let totalBytes = 0;
        const hashFiles = await fs.readdir(this.hashDir);
        for (const file of hashFiles) {
            const stats = await fs.stat(path.join(this.hashDir, file));
            totalBytes += stats.size;
        }
        // 计算唯一内容数
        const uniqueHashes = new Set(allMetadata.map((m) => m.contentHash));
        return {
            totalSnapshots: allMetadata.length,
            totalStorageBytes: totalBytes,
            uniqueContentCount: uniqueHashes.size,
        };
    }
    /**
     * 计算内容哈希
     */
    calculateHash(content) {
        return crypto.createHash("sha256").update(content).digest("hex").substring(0, 16);
    }
    /**
     * 生成快照ID
     */
    generateSnapshotId() {
        return `snap-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    }
    /**
     * 检查快照是否存在
     */
    async snapshotExists(snapshotId) {
        try {
            const metadataPath = path.join(this.metadataDir, `${snapshotId}.json`);
            await fs.access(metadataPath);
            return true;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=file_snapshot.js.map