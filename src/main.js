//@ts-check

var lang = require('./lang.js');

const DEFAULT_MARKDOWN_SYSTEM_PROMPT = `You are a helpful assistant that can accurately extract and convert content from images into clean Markdown format.`;
const DEFAULT_MARKDOWN_USER_PROMPT = `Accurately extract all content from the image including:
- Text (preserve original languages)
- Mathematical equations (convert to LaTeX)
- Tables (format as Markdown tables)
- Document structure (use headings and sections)

Convert everything to clean Markdown format while:
1. Maintaining original language(s) and layout
2. Preserving exact numerical values and symbols
3. Using $$ LaTeX $$ for equations
4. Creating Markdown tables for tabular data
5. Never adding interpretations or explanations`;
const DEFAULT_PLAINTEXT_SYSTEM_PROMPT = `You are a helpful assistant that can accurately extract and convert content from images into clean plaintext.`;
const DEFAULT_PLAINTEXT_USER_PROMPT = `Please accurately identify the text content in the image:
- Preserve the original language (retain the original arrangement in multilingual contexts)
- Keep all special symbols, numbers, and punctuation
- Maintain the original layout structure (paragraphs, line breaks, indentations, etc.)`;

function supportLanguages() {
  return lang.supportLanguages.map(([standardLang]) => standardLang);
}

function buildHeader(apiKey) {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

function textOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function completeWithError(completion, type, message, addition) {
  return completion({
    error: {
      type,
      message,
      addition,
    },
  });
}

function parseNumberOption(value, defaultValue) {
  const text = textOrEmpty(value);
  if (!text) {
    return defaultValue;
  }

  const number = Number(text);
  return Number.isFinite(number) ? number : defaultValue;
}

function getApiKeys() {
  return textOrEmpty($option.apiKeys)
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

function getModelName() {
  if ($option.visionModel === 'custom') {
    return textOrEmpty($option.custom_model_name);
  }

  return textOrEmpty($option.visionModel) || 'gpt-4o-mini';
}

function getOcrMode() {
  return textOrEmpty($option.ocrMode) || 'markdown';
}

function getThinkingMode() {
  return textOrEmpty($option.thinkingMode) || 'default';
}


function createUserPrompt() {
  const ocrMode = getOcrMode();
  if (ocrMode === 'custom') {
    return textOrEmpty($option.ocrUserPrompt);
  }
  else if (ocrMode === 'markdown') {
    return DEFAULT_MARKDOWN_USER_PROMPT;
  } else {
    return DEFAULT_PLAINTEXT_USER_PROMPT;
  }
}

function createSystemPrompt() {
  const ocrMode = getOcrMode();
  if (ocrMode === 'custom') {
    return textOrEmpty($option.ocrSystemPrompt);
  }
  else if (ocrMode === 'markdown') {
    return DEFAULT_MARKDOWN_SYSTEM_PROMPT;
  } else {
    return DEFAULT_PLAINTEXT_SYSTEM_PROMPT;
  }
}


function buildBody(imageUrl, model) {
  const body = {
    model: model,
    temperature: parseNumberOption($option.temperature, 0.7),
    max_tokens: parseNumberOption($option.max_tokens, 4096),
    messages: [{
      role: 'system',
      content: createSystemPrompt(),
    }, {
      role: 'user',
      content: [{
        type: 'text',
        text: createUserPrompt()
      }, {
        type: 'image_url',
        image_url: {
          url: imageUrl
        }
      }]
    }]
  };

  const thinkingMode = getThinkingMode();
  if (thinkingMode === 'enabled' || thinkingMode === 'disabled') {
    body.thinking = { type: thinkingMode };
  }

  return body;
}


async function ocr(query, completion) {
  try {
    const imageData = query.image;

    const base64Image = imageData.toBase64();
    if (!base64Image) {
      return completeWithError(
        completion,
        'param',
        '图片数据转换失败',
        JSON.stringify({ status: 400 })
      );
    }

    const imageUrl = `data:image/jpeg;base64,${base64Image}`;

    const apiKeySelection = getApiKeys();
    if (!apiKeySelection.length) {
      return completeWithError(
        completion,
        'secretKey',
        '配置错误 - 未填写 API Keys',
        '请在插件配置中填写 API Keys'
      );
    }

    const model = getModelName();
    if (!model) {
      return completeWithError(
        completion,
        'param',
        '配置错误 - 未填写自定义模型名',
        '请选择预设模型，或在插件配置中填写自定义模型名'
      );
    }

    if (getOcrMode() === 'custom') {
      if (!createSystemPrompt()) {
        return completeWithError(
          completion,
          'param',
          '配置错误 - 未填写 OCR 系统指令',
          '自定义 OCR 模式需要填写系统指令'
        );
      }

      if (!createUserPrompt()) {
        return completeWithError(
          completion,
          'param',
          '配置错误 - 未填写 OCR 用户指令',
          '自定义 OCR 模式需要填写用户指令'
        );
      }
    }
  
    const apiKey =
      apiKeySelection[Math.floor(Math.random() * apiKeySelection.length)];

    const header = buildHeader(apiKey);
    const body = buildBody(imageUrl, model);

    const baseUrl = (textOrEmpty($option.apiUrl) || "https://api.openai.com").replace(/\/$/, "");
    const urlPath = (textOrEmpty($option.apiUrlPath) || "/v1/chat/completions").replace(/^\//, "");
    const fullUrl = `${baseUrl}/${urlPath}`;
    $http.request({
      method: 'POST',
      url: fullUrl,
      header,
      body,
      handler: (result) => {
        if (result.error || !result.response || result.response.statusCode >= 400) {
          let errorMessage = 'OCR请求失败';
          /** @type {any} */
          const resultData = result.data;
          /** @type {any} */
          const resultError = result.error;

          if (resultError) {
            errorMessage = `网络请求失败: ${resultError.code || '未知错误码'}`;
           
            if ((resultData)?.error?.message) {
              errorMessage += `: ${resultData.error.message}`
            }
          }
          else if (result.response) {
            const statusCode = result.response.statusCode;
            const statusText = statusCode || '未知错误';
            errorMessage = `HTTP错误 ${statusCode} (${statusText})`;
            
            const details = [];
            if (resultData?.error?.message) {
              details.push(`错误信息: ${resultData.error.message}`);
            }

            if (resultData?.error?.debugMessage) {
              details.push(`调试信息: ${resultData.error.debugMessage}`);
            }
            
            details.push(`完整响应: ${JSON.stringify(resultData, null, 2)}`);
            
            $log.error(`请求失败:\n状态码: ${statusCode}\n状态描述: ${statusText}\n${details.join('\n')}`);
            
            if (details.length > 0) {
              errorMessage += `\n${details.join('\n')}`;
            }
          }

          completion({
            error: {
              type: 'api',
              message: errorMessage,
              addition: JSON.stringify(result),
            },
          });
          return;
        }
        
        try {
          /** @type {any} */
          const resultData = result.data;
          if (!resultData || !resultData.choices || !resultData.choices[0] || !resultData.choices[0].message) {
            completion({
              error: {
                type: 'api',
                message: '未获取到有效的识别结果',
                addition: JSON.stringify(result),
              },
            });
            $log.error(`未获取到有效的识别结果: ${JSON.stringify(result)}`);
            return;
          }
          const text = resultData.choices[0].message.content;
          completion({
            result: {
              texts: [{ text }],
              from: query.detectFrom
            },
          });
        } catch (e) {
          completion({
            error: {
              type: 'api',
              message: '响应解析失败',
              addition: JSON.stringify(result),
            },
          });
        }
      }
    });
  } catch (error) {
    completion({
      error: {
        type: error._type || 'unknown',
        message: error._message || '未知错误',
        addition: error._addition
      }
    });
  }
}

exports.supportLanguages = supportLanguages;
exports.ocr = ocr;
