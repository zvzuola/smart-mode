# HarmonyOS编译检查工具

## 快速开始

### 前置条件

1. 已安装DevEco Studio
2. 设置`DEVECO_HOME`环境变量（可选，工具会自动查找）
3. 已安装HarmonyOS SDK

### 使用方法

```typescript
{
  "tool_name": "HmosCompilation",
  "arguments": {
    "project_abs_path": "C:\\Users\\Yu\\DevEcoStudioProjects\\MyApplication"
  }
}
```

### 返回结果

**成功时**:
```json
{
  "success": true,
  "exit_code": 0,
  "execution_time_ms": 12345
}
```

**失败时**:
```json
{
  "success": false,
  "exit_code": 1,
  "stderr": "ERROR: ...(仅包含错误，警告已过滤)"
}
```

## 特性

✅ 自动查找DevEco Studio
✅ 智能过滤警告信息
✅ 完整的环境变量配置
✅ 详细的错误信息
✅ 100%对齐Rust版本

## 详细文档

请查看: [HMOS_COMPILATION_TOOL.md](../../HMOS_COMPILATION_TOOL.md)
