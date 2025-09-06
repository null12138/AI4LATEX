# AI4LATEX## 

一个基于Cloudflare Workers的在线工具，支持上传数学公式图片，使用AI（Gemini 2.0 Flash Exp/OpenAI）智能识别并转换为可编辑的LaTeX代码。

### ✨ 功能特点

- 🚀 **极速部署**：基于Cloudflare Workers全球边缘网络，全球访问秒级响应
- 🤖 **多AI支持**：内置Gemini 2.0 Flash Exp和OpenAI API双重支持
- 🔒 **隐私安全**：所有图片识别均在边缘节点完成，不会上传到第三方服务器
- 📱 **响应式设计**：完美适配桌面端/移动端浏览器
- 🎨 **实时预览**：支持LaTeX代码实时渲染预览
- 🛡️ **错误容错**：内置智能重试机制和错误处理
- 🖼️ **多格式支持**：支持PNG/JPG/WEBP格式，最大3MB

### 🚀 快速开始

#### 1. Fork & Clone
```bash
git clone https://github.com/yourusername/latex-ocr-worker.git
cd latex-ocr-worker
```

#### 2. 配置API密钥
创建 `.dev.vars` 文件（本地开发）或在Workers设置中配置环境变量：

```bash
OPENAI_API_KEY=your_openai_api_key  # 或
GEMINI_API_KEY=your_gemini_api_key  # 推荐使用
API_KEY=your_api_key                 # 备用通用密钥
```

#### 3. 部署到Cloudflare Workers
```bash
# 安装wrangler
npm install -g wrangler

# 登录Cloudflare
wrangler login

# 部署项目
wrangler deploy
```

#### 4. 访问应用
部署成功后，会获得一个workers.dev域名，如：
`https://your-workername.workers.dev`

### ⚙️ 环境变量说明

| 变量名           | 是否必需 | 默认值         | 说明                          |
| ---------------- | -------- | -------------- | ----------------------------- |
| `OPENAI_API_KEY` | 是       | -              | OpenAI API密钥（可选）        |
| `GEMINI_API_KEY` | 否       | -              | Google Gemini API密钥（推荐） |
| `API_KEY`        | 否       | -              | 通用API密钥（备用）           |
| `AI_ENDPOINT`    | 否       | 内置 endpoints | 自定义API端点（可选）         |

### 🔌 API文档

#### 请求文件上传
```http
POST /
Content-Type: multipart/form-data
Accept: application/json

--form-data "image=@your_formula.png"
```

#### 响应格式
```json
{
  "latex": "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
  "endpoint": "https://api.openai.com/v1/chat/completions",
  "raw": "API原始响应数据"
}
```

#### 错误响应
```json
{
  "error": "不支持的图片格式",
  "latex": "错误信息",
  "raw": "错误详情"
}
```

### 💻 前端使用说明

1. **访问页面**：在浏览器中打开Workers部署地址
2. **上传图片**：
   - 点击选择区域或拖拽图片
   - 支持剪贴板粘贴图片（Ctrl+V）
   - 支持格式：PNG/JPG/WEBP（<3MB）
3. **识别处理**：
   - 点击"识别LaTeX公式"
   - 系统自动进行OCR处理（约30-60秒）
4. **结果查看**：
   - 切换"LaTeX代码"/"渲染预览"视图
   - 一键复制LaTeX代码
   - 支持重新渲染预览

### 🛠️ 开发调试

```bash
# 本地开发模式
wrangler dev

# 模拟生产环境测试
curl -X POST \
  -F "image=@test.png" \
  http://localhost:8787/
```

### 📈 性能优化

1. **边缘缓存**：内置60秒响应缓存
2. **智能重试**：
   - 首选Gemini端点（高性能）
   - 自动重试失败请求（最多3次）
   - 20秒请求超时保护
3. **体积优化**：
   - 基础脚本<50KB
   - 图片智能压缩处理

### 🐛 故障排除

| 问题         | 解决方案                                |
| ------------ | --------------------------------------- |
| 识别速度慢   | 检查API密钥配额，尝试关闭页面标签页重试 |
| 525 SSL错误  | 原生支持SSL降级重试，多数情况自动恢复   |
| 大图上传失败 | 压缩图片至<3MB或转为PNG/JPG格式         |
| 错误码5xx    | 检查API密钥有效性，更换备用API端点      |

### 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

### 🤝 贡献指南

欢迎提交Issue和Pull Request！在提交前请：

1. 检查现有Issues避免重复
2. 遵循代码风格规范
3. 添加必要的测试用例

---

> **提示**：部署后可自定义域名（workers.dev自域名），使用方法：在Cloudflare仪表板中添加自定义域名DNS记录

**© 2023 图片转LaTeX工具 - [MIT License](LICENSE)**