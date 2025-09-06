export default {
  async fetch(request, env) {
    // CORS 头配置
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // 处理预检请求
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 处理POST请求 - 图片识别
    if (request.method === "POST") {
      return handleImageUpload(request, env, corsHeaders);
    }

    // 处理GET请求 - 返回前端页面
    return new Response(getHTMLContent(), {
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
        ...corsHeaders
      }
    });
  }
};

// 处理图片上传和识别的函数
async function handleImageUpload(request, env, corsHeaders) {
  const startTime = Date.now();
  const MAX_PROCESSING_TIME = 90000; // 90秒处理时间限制 (考虑重试机制)

  try {
    console.log("开始处理图片上传请求");

    // 1. 解析表单数据
    const formData = await request.formData();
    const file = formData.get("image");

    if (!file) {
      console.log("错误: 未上传图片");
      return createErrorResponse("未上传图片", 400, corsHeaders);
    }

    console.log(`收到文件: ${file.name}, 大小: ${file.size}, 类型: ${file.type}`);

    // 2. 验证文件
    const validation = validateFile(file);
    if (validation.error) {
      console.log(`文件验证失败: ${validation.error}`);
      return createErrorResponse(validation.error, 400, corsHeaders);
    }

    // 3. 检查API密钥
    const apiKey = env.OPENAI_API_KEY || env.GEMINI_API_KEY || env.API_KEY;
    if (!apiKey) {
      console.log("错误: 缺少API密钥");
      return createErrorResponse("服务器配置错误：缺少API密钥。请设置 OPENAI_API_KEY、GEMINI_API_KEY 或 API_KEY 环境变量", 500, corsHeaders);
    }

    console.log("API密钥已配置，开始转换图片");

    // 4. 转换图片为Base64（优化版本）
    const base64Data = await convertToBase64(file);
    if (!base64Data) {
      console.log("Base64转换失败");
      return createErrorResponse("图片处理失败", 400, corsHeaders);
    }

    console.log(`Base64转换成功，长度: ${base64Data.length}`);

    // 5. 检查处理时间
    if (Date.now() - startTime > MAX_PROCESSING_TIME) {
      console.log("处理超时");
      return createErrorResponse("处理超时，请重试", 408, corsHeaders);
    }

    console.log("开始调用API (带重试机制)");

    // 6. 调用API (带重试机制)
    const result = await callAPI(apiKey, file.type, base64Data);

    console.log("API调用完成，返回结果");

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });

  } catch (error) {
    console.error("处理错误:", error);
    return createErrorResponse(
      `服务器错误: ${error.message || "未知错误"}`,
      500,
      corsHeaders
    );
  }
}

// 文件验证函数
function validateFile(file) {
  // 检查文件类型
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return { error: "不支持的图片格式，请上传 PNG/JPG/JPEG/WEBP" };
  }

  // 检查文件大小 (3MB限制)
  if (file.size > 3 * 1024 * 1024) {
    return { error: "图片过大，请上传小于3MB的图片" };
  }

  return { valid: true };
}

// 优化的Base64转换函数
async function convertToBase64(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // 使用更高效的方式转换
    let binaryString = '';
    const chunkSize = 2048; // 2KB块

    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
      binaryString += String.fromCharCode(...chunk);
    }

    return btoa(binaryString);
  } catch (error) {
    console.error("Base64转换失败:", error);
    return null;
  }
}

// API调用函数 - 带重试机制和多端点支持
async function callAPI(apiKey, fileType, base64Data) {
  const payload = {
    model: "gemini-2.0-flash-exp",
    messages: [{
      role: "user",
      content: [
        {
          type: "text",
          text: `请仔细识别图片中的数学公式，并将其转换为标准的LaTeX代码。

要求：
1. 只输出纯LaTeX代码，不要任何解释或markdown标记
2. 确保LaTeX语法正确，可以直接使用
3. 对于分式使用\\frac{}{}，对于根号使用\\sqrt{}
4. 对于上下标使用^{}和_{}，对于希腊字母使用对应的LaTeX命令
5. 对于矩阵使用\\begin{pmatrix}...\\end{pmatrix}或\\begin{bmatrix}...\\end{bmatrix}
6. 对于积分使用\\int，求和使用\\sum，乘积使用\\prod
7. 对于多行公式，使用\\\\换行，使用&对齐
8. 保持原公式的结构和布局

示例输出格式：
x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}

现在请识别图片中的数学公式：`
        },
        {
          type: "image_url",
          image_url: { url: `data:${fileType};base64,${base64Data}` }
        }
      ]
    }],
    max_tokens: 500,
    temperature: 0
  };

  // 多个API端点，按优先级尝试
  const endpoints = [
    "https://api.openai.com/v1/chat/completions",
    "https://openai.api2d.net/v1/chat/completions"
  ];

  let lastError = null;

  for (let endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex++) {
    const endpoint = endpoints[endpointIndex];
    console.log(`尝试API端点 ${endpointIndex + 1}/${endpoints.length}: ${endpoint}`);

    // 对每个端点最多重试3次
    for (let retry = 0; retry < 3; retry++) {
      if (retry > 0) {
        console.log(`第 ${retry + 1} 次重试`);
        // 重试前等待1-3秒
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20秒超时

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; CloudflareWorker/1.0)",
            "Accept": "application/json",
            "Cache-Control": "no-cache"
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        const responseText = await response.text();

        console.log(`API响应状态: ${response.status} (端点: ${endpointIndex + 1}, 重试: ${retry + 1})`);
        console.log(`API响应内容: ${responseText.substring(0, 200)}`);

        // 525错误特殊处理 - 继续重试
        if (response.status === 525) {
          console.log("遇到525错误，继续重试下一个端点或重试");
          lastError = {
            error: `SSL握手失败 (525) - 端点 ${endpointIndex + 1}`,
            latex: "连接失败",
            raw: `525错误: ${responseText.substring(0, 200)}`
          };
          continue;
        }

        // 其他HTTP错误
        if (!response.ok) {
          let errorMsg = `API请求失败 (${response.status})`;
          try {
            const errorData = JSON.parse(responseText);
            if (errorData.error?.message) {
              errorMsg += `: ${errorData.error.message}`;
            }
          } catch (e) {
            errorMsg += `: ${responseText.substring(0, 100)}`;
          }

          // 4xx错误不重试
          if (response.status >= 400 && response.status < 500) {
            return {
              error: errorMsg,
              latex: "请求失败",
              raw: responseText.substring(0, 500)
            };
          }

          // 5xx错误继续重试
          lastError = {
            error: errorMsg,
            latex: "服务器错误",
            raw: responseText.substring(0, 500)
          };
          continue;
        }

        // 成功响应
        try {
          const data = JSON.parse(responseText);
          let latex = extractLatex(data);

          console.log(`成功获取结果 (端点: ${endpointIndex + 1}, 重试: ${retry + 1})`);
          return {
            latex: latex,
            raw: JSON.stringify(data, null, 1).substring(0, 1000),
            endpoint: endpoint
          };
        } catch (parseError) {
          console.error("JSON解析失败:", parseError);
          lastError = {
            error: "响应解析失败",
            latex: "解析错误",
            raw: responseText.substring(0, 500)
          };
          continue;
        }

      } catch (error) {
        clearTimeout(timeoutId);
        console.error(`API请求错误 (端点: ${endpointIndex + 1}, 重试: ${retry + 1}):`, error);

        let errorMsg = "网络请求失败";
        if (error.name === 'AbortError') {
          errorMsg = "请求超时";
        } else if (error.message) {
          errorMsg += `: ${error.message}`;
        }

        lastError = {
          error: errorMsg,
          latex: "请求失败",
          raw: error.toString()
        };
      }
    }
  }

  // 所有端点和重试都失败了
  console.error("所有API端点都失败了");
  return lastError || {
    error: "所有API端点都无法连接",
    latex: "连接失败",
    raw: "网络连接问题，请稍后重试"
  };
}

// 提取LaTeX代码 - 优化版本
function extractLatex(data) {
  try {
    if (data.choices?.[0]?.message?.content) {
      let content = data.choices[0].message.content.trim();

      // 清理各种可能的markdown标记
      content = content.replace(/^```(?:latex|math|tex)?\s*\n?/i, '').replace(/\n?```\s*$/, '');

      // 移除可能的解释文字（保留LaTeX代码）
      const patterns = [
        // 匹配"这是..."、"答案是..."等开头的解释
        /^(?:这是|答案是|结果是|公式是|识别到的公式是|LaTeX代码是)[：:]?\s*/i,
        // 匹配"The LaTeX code is:"等英文解释
        /^(?:The\s+(?:LaTeX\s+)?(?:code|formula|equation)\s+is)[：:]?\s*/i,
        // 匹配单独的解释行
        /^(?:LaTeX代码|数学公式|识别结果)[：:]?\s*\n/im,
      ];

      patterns.forEach(pattern => {
        content = content.replace(pattern, '');
      });

      // 清理前后空白
      content = content.trim();

      // 移除可能的双美元符号包装
      if (content.startsWith('$$') && content.endsWith('$$')) {
        content = content.slice(2, -2).trim();
      }

      // 移除可能的单美元符号包装
      if (content.startsWith('$') && content.endsWith('$') && !content.includes('$$')) {
        content = content.slice(1, -1).trim();
      }

      // 验证是否包含LaTeX命令
      const hasLatexCommands = /\\[a-zA-Z]+/.test(content);
      const hasLatexSymbols = /[\{\}\\^_]/.test(content);

      // 如果内容看起来不像LaTeX，尝试从原始内容中提取
      if (!hasLatexCommands && !hasLatexSymbols && content.length > 0) {
        const originalContent = data.choices[0].message.content;

        // 尝试提取$$...$$包围的内容
        let mathMatch = originalContent.match(/\$\$([^$]+)\$\$/);
        if (mathMatch) {
          content = mathMatch[1].trim();
        } else {
          // 尝试提取$...$包围的内容
          mathMatch = originalContent.match(/\$([^$]+)\$/);
          if (mathMatch) {
            content = mathMatch[1].trim();
          }
        }
      }

      // 最终验证和清理
      if (content && content.length > 0) {
        // 确保常见的LaTeX命令格式正确
        content = content
          // 修正可能的空格问题
          .replace(/\\\s+([a-zA-Z]+)/g, '\\$1')
          // 修正分数格式
          .replace(/\\frac\s*{([^}]*)}\s*{([^}]*)}/g, '\\frac{$1}{$2}')
          // 修正根号格式
          .replace(/\\sqrt\s*{([^}]*)}/g, '\\sqrt{$1}')
          // 修正上下标格式
          .replace(/\^\s*{([^}]*)}/g, '^{$1}')
          .replace(/_\s*{([^}]*)}/g, '_{$1}');

        return content;
      }

      return "未识别到LaTeX代码";
    } else if (data.error) {
      return `API错误: ${data.error.message || JSON.stringify(data.error)}`;
    } else {
      return "未识别到LaTeX代码";
    }
  } catch (error) {
    console.error("LaTeX提取错误:", error);
    return "响应处理失败";
  }
}

// 创建错误响应
function createErrorResponse(message, status, corsHeaders) {
  return new Response(JSON.stringify({
    error: message,
    latex: message,
    raw: `错误: ${message}`
  }), {
    status: status,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}

// 前端HTML内容
function getHTMLContent() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>图片转LaTeX公式</title>
  <!-- MathJax 数学公式渲染引擎 -->
  <script>
    window.MathJax = {
      tex: {
        inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
        displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']],
        processEscapes: true,
        processEnvironments: true,
        macros: {
          R: "\\\\mathbb{R}",
          C: "\\\\mathbb{C}",
          N: "\\\\mathbb{N}",
          Z: "\\\\mathbb{Z}",
          Q: "\\\\mathbb{Q}"
        }
      },
      chtml: {
        scale: 1.2,
        minScale: 0.8,
        matchFontHeight: false,
        fontURL: 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/output/chtml/fonts/woff-v2'
      },
      svg: {
        scale: 1.2,
        minScale: 0.8,
        fontCache: 'local'
      },
      options: {
        skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre'],
        renderActions: {
          addMenu: [0, '', '']
        }
      },
      startup: {
        ready: () => {
          console.log('MathJax已准备就绪');
          MathJax.startup.defaultReady();
        }
      }
    };
  </script>
  <script src="https://polyfill.io/v3/polyfill.min.js?features=es6"></script>
  <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    
    .header {
      background: linear-gradient(45deg, #667eea, #764ba2);
      color: white;
      text-align: center;
      padding: 30px 20px;
    }
    
    .header h1 {
      font-size: 1.8em;
      margin-bottom: 8px;
    }
    
    .header p {
      opacity: 0.9;
      font-size: 0.95em;
    }
    
    .main {
      padding: 30px;
    }
    
    .upload-zone {
      border: 2px dashed #d1d5db;
      border-radius: 8px;
      padding: 40px 20px;
      text-align: center;
      cursor: pointer;
      transition: all 0.3s ease;
      background: #f9fafb;
    }
    
    .upload-zone:hover {
      border-color: #667eea;
      background: #f0f4ff;
    }
    
    .upload-zone.dragover {
      border-color: #667eea;
      background: #e0e7ff;
      transform: scale(1.02);
    }
    
    .upload-zone.selected {
      border-color: #10b981;
      background: #ecfdf5;
    }
    
    .upload-zone input {
      display: none;
    }
    
    .upload-icon {
      font-size: 2.5em;
      margin-bottom: 16px;
      opacity: 0.6;
    }
    
    .upload-text {
      font-size: 1.1em;
      color: #374151;
      margin-bottom: 8px;
    }
    
    .upload-hint {
      font-size: 0.9em;
      color: #6b7280;
    }
    
    .btn {
      width: 100%;
      padding: 12px;
      margin-top: 20px;
      background: linear-gradient(45deg, #667eea, #764ba2);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1em;
      cursor: pointer;
      transition: transform 0.2s;
    }
    
    .btn:hover {
      transform: translateY(-2px);
    }
    
    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    
    .result {
      margin-top: 25px;
      display: none;
    }
    
    .result-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }
    
    .result-title {
      font-weight: 600;
      color: #374151;
      font-size: 1em;
    }
    
    .view-controls {
      display: flex;
      gap: 8px;
    }
    
    .view-btn {
      padding: 6px 12px;
      border: 1px solid #d1d5db;
      background: white;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85em;
      transition: all 0.2s;
    }
    
    .view-btn.active {
      background: #667eea;
      color: white;
      border-color: #667eea;
    }
    
    .view-btn:hover:not(.active) {
      background: #f3f4f6;
    }
    
    .latex-output {
      background: #f3f4f6;
      border-radius: 8px;
      padding: 16px;
      font-family: 'Courier New', monospace;
      font-size: 1em;
      line-height: 1.5;
      border: 1px solid #e5e7eb;
      word-break: break-all;
      min-height: 60px;
    }
    
    .rendered-output {
      background: white;
      border-radius: 8px;
      padding: 30px 20px;
      border: 1px solid #e5e7eb;
      text-align: center;
      font-size: 1.4em;
      min-height: 120px;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1.6;
      overflow-x: auto;
      overflow-y: hidden;
    }
    
    /* MathJax 数学公式样式优化 */
    .rendered-output .MathJax {
      font-size: 1.3em !important;
    }
    
    .rendered-output mjx-container {
      margin: 0.5em 0 !important;
    }
    
    .rendered-output mjx-container[display="true"] {
      margin: 1em 0 !important;
      font-size: 1.4em !important;
    }
    
    /* 优化数学符号显示 */
    .rendered-output mjx-math {
      color: #1f2937 !important;
      font-weight: normal !important;
    }
    
    /* 分式线条优化 */
    .rendered-output mjx-mfrac {
      margin: 0.2em 0;
    }
    
    /* 根号符号优化 */
    .rendered-output mjx-msqrt {
      margin: 0.1em 0;
    }
    
    /* 上下标优化 */
    .rendered-output mjx-msubsup, .rendered-output mjx-msub, .rendered-output mjx-msup {
      margin: 0;
    }
    
    .rendered-output.error {
      color: #dc2626;
      font-size: 0.9em;
      font-style: italic;
    }
    
    .copy-btn {
      margin-top: 15px;
      padding: 8px 16px;
      background: #10b981;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9em;
      width: 100%;
    }
    
    .copy-btn:hover {
      background: #059669;
    }
    
    .action-buttons {
      display: flex;
      gap: 8px;
      margin-top: 15px;
    }
    
    .action-buttons .copy-btn {
      flex: 1;
      width: auto;
      margin-top: 0;
    }
    
    .render-btn {
      flex: 1;
      padding: 8px 16px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9em;
    }
    
    .render-btn:hover {
      background: #5a67d8;
    }
    
    .error {
      background: #fef2f2;
      color: #dc2626;
      padding: 12px;
      border-radius: 8px;
      margin-top: 15px;
      border: 1px solid #fecaca;
    }
    
    .loading {
      display: none;
      text-align: center;
      margin-top: 20px;
      color: #6b7280;
    }
    
    .spinner {
      width: 20px;
      height: 20px;
      border: 2px solid #e5e7eb;
      border-top: 2px solid #667eea;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      display: inline-block;
      margin-right: 8px;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    @media (max-width: 640px) {
      .container { margin: 10px; }
      .main { padding: 20px; }
      .header { padding: 20px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📝 图片转LaTeX公式</h1>
      <p>使用AI识别数学公式并转换为LaTeX代码</p>
    </div>
    
    <div class="main">
      <form id="uploadForm">
        <div class="upload-zone" id="uploadZone">
          <input type="file" id="fileInput" accept="image/png,image/jpeg,image/jpg,image/webp">
          <div class="upload-icon">📁</div>
          <div class="upload-text" id="uploadText">点击选择图片或拖拽到此处</div>
          <div class="upload-hint">支持 PNG、JPG、WEBP 格式，最大 3MB</div>
        </div>
        <button type="submit" class="btn" id="submitBtn">🔍 识别LaTeX公式</button>
      </form>
      
      <div class="loading" id="loading">
        <div class="spinner"></div>
        正在识别中，请稍候...<br>
        <small style="opacity: 0.8; font-size: 0.8em;">AI模型正在分析您的数学公式，可能需要30-60秒</small>
      </div>
      
      <div class="result" id="result">
        <div class="result-header">
          <div class="result-title">识别结果</div>
          <div class="view-controls">
            <button class="view-btn active" id="codeViewBtn" onclick="switchView('code')">LaTeX代码</button>
            <button class="view-btn" id="renderViewBtn" onclick="switchView('render')">渲染预览</button>
          </div>
        </div>
        <div class="latex-output" id="latexOutput"></div>
        <div class="rendered-output" id="renderedOutput" style="display: none;"></div>
        <div class="action-buttons">
          <button class="copy-btn" onclick="copyLatex()">📋 复制LaTeX代码</button>
          <button class="render-btn" onclick="renderLatex()">🔄 重新渲染</button>
        </div>
      </div>
      
      <div id="errorDiv"></div>
    </div>
  </div>

  <script>
    let selectedFile = null;
    let currentLatex = '';
    let currentView = 'code';
    
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    const uploadForm = document.getElementById('uploadForm');
    const uploadText = document.getElementById('uploadText');
    const submitBtn = document.getElementById('submitBtn');
    const loading = document.getElementById('loading');
    const result = document.getElementById('result');
    const latexOutput = document.getElementById('latexOutput');
    const renderedOutput = document.getElementById('renderedOutput');
    const errorDiv = document.getElementById('errorDiv');
    const codeViewBtn = document.getElementById('codeViewBtn');
    const renderViewBtn = document.getElementById('renderViewBtn');
    
    // 文件选择事件
    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    
    // 拖拽事件
    uploadZone.addEventListener('dragover', handleDragOver);
    uploadZone.addEventListener('dragleave', handleDragLeave);
    uploadZone.addEventListener('drop', handleDrop);
    
    // 粘贴事件
    document.addEventListener('paste', handlePaste);
    
    // 表单提交
    uploadForm.addEventListener('submit', handleSubmit);
    
    function handleFileSelect(e) {
      if (e.target.files.length > 0) {
        processFile(e.target.files[0]);
      }
    }
    
    function handleDragOver(e) {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    }
    
    function handleDragLeave() {
      uploadZone.classList.remove('dragover');
    }
    
    function handleDrop(e) {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        processFile(e.dataTransfer.files[0]);
      }
    }
    
    function handlePaste(e) {
      e.preventDefault();
      const items = e.clipboardData?.items;
      if (!items) return;
      
      for (let item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) processFile(file);
          break;
        }
      }
    }
    
    function processFile(file) {
      // 验证文件
      if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) {
        showError('不支持的图片格式，请上传 PNG、JPG 或 WEBP 格式');
        return;
      }
      
      if (file.size > 3 * 1024 * 1024) {
        showError('图片过大，请上传小于3MB的图片');
        return;
      }
      
      selectedFile = file;
      uploadZone.classList.add('selected');
      uploadText.textContent = \`已选择: \${file.name} (\${formatFileSize(file.size)})\`;
      clearError();
    }
    
    async function handleSubmit(e) {
      e.preventDefault();
      
      if (!selectedFile) {
        showError('请先选择图片');
        return;
      }
      
      setLoading(true);
      
      try {
        const formData = new FormData();
        formData.append('image', selectedFile);
        
        const response = await fetch('', {
          method: 'POST',
          body: formData
        });
        
        const data = await response.json();
        
        if (data.latex && data.latex !== data.error) {
          showResult(data.latex);
        } else {
          showError(data.error || '识别失败，请重试');
        }
      } catch (error) {
        showError('网络请求失败，请检查连接后重试');
      } finally {
        setLoading(false);
      }
    }
    
    function setLoading(isLoading) {
      loading.style.display = isLoading ? 'block' : 'none';
      submitBtn.disabled = isLoading;
      if (isLoading) {
        result.style.display = 'none';
        clearError();
      }
    }
    
    function showResult(latex) {
      currentLatex = latex;
      latexOutput.textContent = latex;
      result.style.display = 'block';
      
      // 自动渲染LaTeX
      renderLatex();
    }
    
    function showError(message) {
      errorDiv.innerHTML = \`<div class="error">\${message}</div>\`;
    }
    
    function clearError() {
      errorDiv.innerHTML = '';
    }
    
    function formatFileSize(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    
    function copyLatex() {
      const text = currentLatex || latexOutput.textContent;
      navigator.clipboard.writeText(text).then(() => {
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = '✅ 已复制';
        btn.style.background = '#10b981';
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = '';
        }, 2000);
      }).catch(() => {
        // 降级复制方案
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      });
    }
    
    function switchView(view) {
      currentView = view;
      
      if (view === 'code') {
        latexOutput.style.display = 'block';
        renderedOutput.style.display = 'none';
        codeViewBtn.classList.add('active');
        renderViewBtn.classList.remove('active');
      } else {
        latexOutput.style.display = 'none';
        renderedOutput.style.display = 'flex';
        codeViewBtn.classList.remove('active');
        renderViewBtn.classList.add('active');
        renderLatex();
      }
    }
    
    function renderLatex() {
      if (!currentLatex) return;
      
      try {
        // 清理渲染输出区域
        renderedOutput.innerHTML = '';
        renderedOutput.classList.remove('error');
        
        // 显示加载提示
        renderedOutput.innerHTML = '<div style="color: #6b7280; font-size: 0.9em;">正在渲染数学公式...</div>';
        
        // 准备LaTeX代码进行渲染
        let latexToRender = currentLatex.trim();
        
        // 如果代码没有包装在数学模式中，自动添加
        if (!latexToRender.startsWith('$') && !latexToRender.startsWith('\\\\[') && !latexToRender.startsWith('\\\\(')) {
          // 对于复杂公式使用display模式
          if (latexToRender.includes('\\\\\\\\\\\\\\\\') || 
              latexToRender.includes('\\\\begin{') || 
              latexToRender.includes('\\\\end{') ||
              latexToRender.includes('\\\\frac') ||
              latexToRender.includes('\\\\sum') ||
              latexToRender.includes('\\\\int') ||
              latexToRender.includes('\\\\prod') ||
              latexToRender.length > 30) {
            latexToRender = \`\\\\[\${latexToRender}\\\\]\`;
          } else {
            latexToRender = \`$\${latexToRender}$\`;
          }
        }
        
        // 清理加载提示
        setTimeout(() => {
          renderedOutput.innerHTML = '';
          
          // 创建一个容器来放置LaTeX代码
          const mathContainer = document.createElement('div');
          mathContainer.innerHTML = latexToRender;
          mathContainer.style.width = '100%';
          mathContainer.style.display = 'flex';
          mathContainer.style.justifyContent = 'center';
          mathContainer.style.alignItems = 'center';
          mathContainer.style.minHeight = '60px';
          renderedOutput.appendChild(mathContainer);
          
          // 使用MathJax渲染
          if (window.MathJax && window.MathJax.typesetPromise) {
            window.MathJax.typesetPromise([mathContainer]).then(() => {
              console.log('LaTeX渲染成功');
              
              // 渲染完成后的样式调整
              const mjxContainers = mathContainer.querySelectorAll('mjx-container');
              mjxContainers.forEach(container => {
                container.style.margin = '0.5em 0';
                if (container.getAttribute('display') === 'true') {
                  container.style.fontSize = '1.4em';
                } else {
                  container.style.fontSize = '1.3em';
                }
              });
              
            }).catch((err) => {
              console.error('LaTeX渲染失败:', err);
              showRenderError('渲染失败：LaTeX语法可能有误');
            });
          } else {
            // MathJax未加载完成，等待后重试
            setTimeout(() => {
              renderLatex();
            }, 1000);
          }
        }, 100);
        
      } catch (error) {
        console.error('渲染错误:', error);
        showRenderError('渲染失败：' + error.message);
      }
    }
    
    function showRenderError(message) {
      renderedOutput.innerHTML = '<div style="color: #dc2626; font-size: 0.9em; font-style: italic; line-height: 1.4;"><div style="margin-bottom: 8px;">⚠️ ' + message + '</div></div>';
      renderedOutput.classList.add('error');
    }
    
    // 等待MathJax加载完成
    window.addEventListener('load', function() {
      if (window.MathJax) {
        console.log('MathJax已加载');
      }
    });
  </script>
</body>
</html>`;
}
