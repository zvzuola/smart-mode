# 字体安装说明

## 📁 目录结构

```
packages/web-ui/public/fonts/
├── fonts.css                           # 字体定义文件
├── README.md                           # 本说明文件
├── FiraCode/                           # 代码编辑器字体（✅ 已安装）
│   ├── FiraCode-Regular.woff2          # 400 字重
│   ├── FiraCode-Medium.woff2           # 500 字重
│   ├── FiraCode-SemiBold.woff2         # 600 字重
│   └── FiraCode-VF.woff2               # 可变字体（300-700）
└── HarmonyOS_SansSC/                   # UI 界面字体（✅ 已安装）
    ├── HarmonyOS_SansSC_Regular.ttf    # 400 字重
    ├── HarmonyOS_SansSC_Medium.ttf     # 500 字重
    └── HarmonyOS_SansSC_Semibold.ttf   # 600 字重
```

---

## Fira Code 字体

**用途：** 代码编辑器、终端

**特性：**
- 专业编程字体，支持连字 (ligatures)
- 等宽字体，适合代码阅读和编写
- 使用 woff2 格式，体积小、加载快

**字重说明：**
| 字重 | 文件 | 用途 |
|------|------|------|
| 400 (Regular) | FiraCode-Regular.woff2 | 正常代码 |
| 500 (Medium) | FiraCode-Medium.woff2 | 中等强调 |
| 600 (SemiBold) | FiraCode-SemiBold.woff2 | 关键字/强调 |
| 300-700 (Variable) | FiraCode-VF.woff2 | 可变字体，按需使用 |

---

## HarmonyOS Sans 字体

**用途：** UI 界面（中英文显示）

**来源：** 华为鸿蒙系统官方字体，开源

**字重说明：**
| 字重 | 文件 | 用途 |
|------|------|------|
| 400 (Regular) | HarmonyOS_SansSC_Regular.ttf | 正文 |
| 500 (Medium) | HarmonyOS_SansSC_Medium.ttf | 标题/强调 |
| 600 (Semibold) | HarmonyOS_SansSC_Semibold.ttf | 重要标题 |

---

## 🎨 当前字体配置

**代码字体（Mono）：**
```scss
'Fira Code', 'HarmonyOS Sans', Consolas, 'Courier New', monospace
```
- 英文/代码：Fira Code
- 中文：HarmonyOS Sans

**界面字体（Sans）：**
```scss
'HarmonyOS Sans', 'PingFang SC', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'SF Pro Display', Roboto, sans-serif
```

---

## 💡 提示

- 字体采用 `font-display: swap` 策略，确保文字快速显示
- 代码编辑器已启用连字功能 (`fontLigatures: true`)
- 如果字体文件不存在，会自动降级到系统字体
