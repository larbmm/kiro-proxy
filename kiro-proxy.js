import express from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { StringDecoder } from 'string_decoder';
import toml from 'toml';
import http from 'http';
import https from 'https';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取配置文件
const configPath = path.join(__dirname, 'config.toml');
const configContent = fs.readFileSync(configPath, 'utf-8');
const config = toml.parse(configContent);

// 读取认证文件（兼容两种格式）
const authPath = path.join(__dirname, config.credentials.auth_file);
let authData;
try {
  if (!fs.existsSync(authPath)) {
    console.error('\n' + '='.repeat(48));
    console.error('❌ 认证文件不存在');
    console.error('='.repeat(48));
    console.error(`找不到文件: ${config.credentials.auth_file}`);
    console.error('\n请按以下步骤操作：');
    console.error('1. 从 Kiro 或相关工具导出认证文件');
    console.error('2. 将文件重命名为: kiro-auth-token.json');
    console.error('3. 放置在项目根目录');
    console.error('\n或者：');
    console.error('在 config.toml 中修改 auth_file 路径指向你的认证文件');
    console.error('\n支持的认证文件格式：');
    console.error('- AIClient-2-API 格式');
    console.error('- Kiro账号管理器格式');
    console.error('\n详细说明请查看 README.md');
    console.error('='.repeat(48) + '\n');
    process.exit(1);
  }
  
  const rawAuthData = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
  
  // 标准化认证数据（兼容 AIClient-2-API 和 kiro账号管理器 两种格式）
  authData = {
    clientId: rawAuthData.clientId,
    clientSecret: rawAuthData.clientSecret,
    accessToken: rawAuthData.accessToken,
    refreshToken: rawAuthData.refreshToken,
    expiresAt: rawAuthData.expiresAt,
    authMethod: rawAuthData.authMethod || 'IdC',
    // 支持两种区域字段名
    region: rawAuthData.region || rawAuthData.idcRegion || 'us-east-1',
    idcRegion: rawAuthData.idcRegion || rawAuthData.region || 'us-east-1',
    // 额外信息（如果有）
    email: rawAuthData.email || rawAuthData.userInfo?.email,
    userId: rawAuthData.userId || rawAuthData.userInfo?.userId,
    profileArn: rawAuthData.profileArn
  };
  
  console.log('✓ 认证文件加载成功');
  if (authData.email) {
    console.log(`  账号: ${authData.email}`);
  }
  console.log(`  认证方式: ${authData.authMethod}`);
  console.log(`  区域: ${authData.region}`);
} catch (error) {
  console.error('\n' + '='.repeat(48));
  console.error('❌ 认证文件加载失败');
  console.error('='.repeat(48));
  console.error(`错误: ${error.message}`);
  console.error('\n可能的原因：');
  console.error('1. 文件格式不正确（需要是有效的 JSON 格式）');
  console.error('2. 文件缺少必要字段（clientId, clientSecret, accessToken 等）');
  console.error('3. 文件编码问题');
  console.error('\n请检查认证文件格式，参考 README.md 中的示例');
  console.error('='.repeat(48) + '\n');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '50mb' }));

// Kiro API 配置
const KIRO_API_BASE = `https://q.${authData.idcRegion || 'us-east-1'}.amazonaws.com`;
const KIRO_VERSION = config.advanced.kiro_version || '0.11.131';

// 配置 HTTP/HTTPS Agent（参考 AIClient-2-API 的实现）
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 5,
  timeout: 120000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 5,
  timeout: 120000,
  rejectUnauthorized: true  // 确保 TLS 验证
});

// 生成或读取设备 UUID
let deviceUUID = config.device.uuid;
if (!deviceUUID || deviceUUID === 'auto-generated-on-first-run') {
  deviceUUID = crypto.randomUUID();
  console.log('✓ 生成新的设备 UUID:', deviceUUID);
  
  // 保存 UUID 到 config.toml
  try {
    let tomlContent = fs.readFileSync(configPath, 'utf-8');
    // 替换 uuid 行
    tomlContent = tomlContent.replace(
      /uuid = "auto-generated-on-first-run"/,
      `uuid = "${deviceUUID}"`
    );
    fs.writeFileSync(configPath, tomlContent, 'utf-8');
    console.log('  已保存到配置文件');
  } catch (error) {
    console.warn('⚠️  无法保存 UUID 到配置文件:', error.message);
  }
} else {
  console.log('✓ 使用已有的设备 UUID');
}

// Token 刷新函数（支持 Social Auth 和 Builder ID 两种方式）
async function refreshAccessToken() {
  try {
    console.log('\n[Token] 正在刷新 Access Token...');
    
    // 根据 authMethod 选择不同的刷新方式
    const authMethod = authData.authMethod || 'IdC';
    let refreshUrl, requestBody;
    
    if (authMethod === 'social') {
      // Social Auth (Google/GitHub) 方式
      const region = authData.region || authData.idcRegion || 'us-east-1';
      refreshUrl = `https://prod.${region}.auth.desktop.kiro.dev/refreshToken`;
      requestBody = {
        refreshToken: authData.refreshToken
      };
      console.log(`[Token] 使用 Social Auth 方式刷新 (region: ${region})`);
    } else {
      // Builder ID (IdC) 方式
      const region = authData.idcRegion || authData.region || 'us-east-1';
      refreshUrl = `https://oidc.${region}.amazonaws.com/token`;
      requestBody = {
        refreshToken: authData.refreshToken,
        clientId: authData.clientId,
        clientSecret: authData.clientSecret,
        grantType: 'refresh_token'
      };
      console.log(`[Token] 使用 Builder ID 方式刷新 (region: ${region})`);
    }
    
    const response = await axios.post(refreshUrl, requestBody, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000,
      httpAgent,
      httpsAgent,
      proxy: false
    });

    const newAccessToken = response.data.accessToken;
    const newRefreshToken = response.data.refreshToken || authData.refreshToken;
    const expiresIn = response.data.expiresIn || 3600;
    const newExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // 更新内存中的认证数据
    authData.accessToken = newAccessToken;
    authData.refreshToken = newRefreshToken;
    authData.expiresAt = newExpiresAt;

    // 保存到文件
    const rawAuthData = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    rawAuthData.accessToken = newAccessToken;
    rawAuthData.refreshToken = newRefreshToken;
    rawAuthData.expiresAt = newExpiresAt;
    fs.writeFileSync(authPath, JSON.stringify(rawAuthData, null, 2), 'utf-8');

    const expiresAtLocal = new Date(newExpiresAt).toLocaleString('zh-CN', { hour12: false });
    console.log('[Token] ✓ 刷新成功');
    console.log(`[Token] 过期时间: ${expiresAtLocal}`);
    
    return true;
  } catch (error) {
    console.error('[Token] ✗ 刷新失败:', error.message);
    if (error.response) {
      console.error('[Token] 响应状态:', error.response.status);
      console.error('[Token] 响应数据:', error.response.data);
    }
    return false;
  }
}

// 检查并刷新 Token（如果需要）
async function ensureValidToken() {
  const expiryDate = new Date(authData.expiresAt);
  const now = new Date();
  const timeUntilExpiry = expiryDate - now;
  const fiveMinutes = 5 * 60 * 1000;

  // 如果已过期或即将在 5 分钟内过期，则刷新
  if (timeUntilExpiry < fiveMinutes) {
    return await refreshAccessToken();
  }
  
  return true;
}

// 健康检查端点
app.get('/health', (req, res) => {
  const healthInfo = { 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    tokenExpiry: authData.expiresAt
  };
  
  if (authData.email) {
    healthInfo.account = authData.email;
  }
  
  res.json(healthInfo);
});

// OpenAI 兼容的聊天完成端点
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, stream = false, model } = req.body;
    
    const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
    console.log(`\n[${timestamp}] 收到请求`);
    console.log(`  模型: ${model || config.model.target_model}`);
    console.log(`  流式: ${stream ? '是' : '否'}`);
    console.log(`  消息数: ${messages?.length || 0}`);

    // 检查并刷新 Token（如果需要）
    const tokenValid = await ensureValidToken();
    if (!tokenValid) {
      console.error('  ✗ Token 刷新失败');
      return res.status(401).json({ 
        error: {
          message: 'Token refresh failed',
          type: 'authentication_error'
        }
      });
    }

    // 转换为 Kiro 格式
    const kiroRequest = convertToKiroFormat(messages);
    
    // 添加延迟
    const delay = Math.random() * (config.advanced.delay_max - config.advanced.delay_min) + config.advanced.delay_min;
    await new Promise(resolve => setTimeout(resolve, delay));

    // 调用 Kiro API
    const response = await callKiroAPI(kiroRequest, stream);
    
    if (stream) {
      // 流式响应
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      let buffer = '';
      const decoder = new StringDecoder('utf8'); // 正确处理 UTF-8 多字节字符
      let lastProcessedIndex = 0; // 记录已处理到的位置，避免重复
      
      response.data.on('data', (chunk) => {
        // 使用 StringDecoder 避免 UTF-8 字符被截断
        const chunkStr = decoder.write(chunk);
        buffer += chunkStr;
        
        // Kiro API 使用二进制格式，需要匹配 :message-type 后面的 event 标记和 JSON
        // 格式: :message-type\x07\x00\x05event{JSON}
        const eventRegex = /:message-type[\x00-\x1F]+event/g;
        let match;
        
        // 从上次处理的位置开始查找
        eventRegex.lastIndex = lastProcessedIndex;
        
        while ((match = eventRegex.exec(buffer)) !== null) {
          const jsonStart = match.index + match[0].length;
          
          // 从 { 开始查找完整的 JSON 对象
          if (buffer[jsonStart] === '{') {
            // 尝试找到匹配的 }
            let braceCount = 0;
            let jsonEnd = -1;
            
            for (let i = jsonStart; i < buffer.length; i++) {
              if (buffer[i] === '{') braceCount++;
              else if (buffer[i] === '}') {
                braceCount--;
                if (braceCount === 0) {
                  jsonEnd = i + 1;
                  break;
                }
              }
            }
            
            // 如果找到完整的 JSON
            if (jsonEnd > 0) {
              const jsonStr = buffer.substring(jsonStart, jsonEnd);
              
              try {
                const eventData = JSON.parse(jsonStr);
                
                // 只处理包含 content 的事件
                if (eventData.content) {
                  // 处理转义字符
                  let content = eventData.content;
                  content = content.replace(/(?<!\\)\\n/g, '\n');
                  
                  // 转换为 OpenAI 格式
                  const openaiChunk = {
                    id: `chatcmpl-${Date.now()}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: config.model.target_model,
                    choices: [{
                      index: 0,
                      delta: {
                        content: content
                      },
                      finish_reason: null
                    }]
                  };
                  
                  res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                }
                
                // 更新已处理位置
                lastProcessedIndex = jsonEnd;
              } catch (e) {
                // JSON 解析失败，继续
              }
            } else {
              // JSON 不完整，等待更多数据
              break;
            }
          }
        }
        
        // 清理已处理的数据，保留未处理的部分
        if (lastProcessedIndex > 2000) {
          buffer = buffer.substring(lastProcessedIndex);
          lastProcessedIndex = 0;
        }
      });
      
      response.data.on('end', () => {
        // 处理剩余的字节
        const remaining = decoder.end();
        if (remaining) {
          buffer += remaining;
        }
        
        // 发送结束标记
        const finalChunk = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: config.model.target_model,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: 'stop'
          }]
        };
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        console.log('  ✓ 流式响应完成');
      });
      
      response.data.on('error', (error) => {
        console.error('  ✗ 流错误:', error.message);
        res.end();
      });
    } else {
      // 非流式响应 - response.data 是 Buffer
      const buffer = response.data.toString('utf8');
      
      // 解析二进制格式，提取所有 content
      let fullContent = '';
      const eventRegex = /:message-type[\x00-\x1F]+event(\{[^\x00]*?\})/g;
      let match;
      
      while ((match = eventRegex.exec(buffer)) !== null) {
        try {
          const eventData = JSON.parse(match[1]);
          if (eventData.content) {
            let content = eventData.content;
            content = content.replace(/(?<!\\)\\n/g, '\n');
            fullContent += content;
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
      
      // 转换为 OpenAI 格式
      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: config.model.target_model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: fullContent
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };
      
      res.json(openaiResponse);
      console.log('  ✓ 非流式响应完成');
    }
    
  } catch (error) {
    console.error('  ✗ 请求失败:', error.message);
    if (error.response) {
      console.error('  响应状态:', error.response.status);
      // 安全地打印响应数据，避免循环引用
      try {
        console.error('  响应数据:', JSON.stringify(error.response.data, null, 2));
      } catch (jsonError) {
        console.error('  响应数据: [无法序列化]');
      }
    }
    res.status(error.response?.status || 500).json({
      error: {
        message: error.message,
        type: 'api_error'
      }
    });
  }
});

// 模型列表端点
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [
      {
        id: config.model.target_model,
        object: 'model',
        created: Date.now(),
        owned_by: 'kiro-proxy'
      }
    ]
  });
});

// 转换为 Kiro 格式
function convertToKiroFormat(messages) {
  const conversationState = {
    agentTaskType: "vibe",
    chatTriggerType: "MANUAL",
    conversationId: crypto.randomUUID(),
    currentMessage: {},
    history: []
  };
  
  // 直接使用配置文件中的模型名
  const kiroModel = config.model.target_model;
  
  // 提取系统消息和用户消息
  const systemMessages = messages.filter(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role !== 'system');
  
  // 构建对话历史（除了最后一条消息）
  for (let i = 0; i < userMessages.length - 1; i++) {
    const msg = userMessages[i];
    if (msg.role === 'user') {
      conversationState.history.push({
        userInputMessage: {
          content: msg.content,
          modelId: kiroModel,
          origin: "AI_EDITOR"
        }
      });
    } else if (msg.role === 'assistant') {
      conversationState.history.push({
        assistantResponseMessage: {
          content: msg.content
        }
      });
    }
  }
  
  // 当前消息（最后一条）
  const lastMessage = userMessages[userMessages.length - 1];
  let currentContent = lastMessage.content;
  
  // 如果有系统消息，添加到当前消息前面
  if (systemMessages.length > 0) {
    const systemPrompt = systemMessages.map(m => m.content).join('\n\n');
    currentContent = `${systemPrompt}\n\n${currentContent}`;
  }
  
  conversationState.currentMessage.userInputMessage = {
    content: currentContent,
    modelId: kiroModel,
    origin: "AI_EDITOR"
  };
  
  return { conversationState };
}

// 转换为 OpenAI 格式
function convertToOpenAIFormat(kiroData, isStream) {
  if (isStream) {
    // 流式响应格式
    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: config.model.target_model,
      choices: [{
        index: 0,
        delta: {
          content: kiroData.content || kiroData.assistantResponseMessage?.content || ''
        },
        finish_reason: kiroData.finish_reason || null
      }]
    };
  } else {
    // 非流式响应格式
    const content = kiroData.assistantResponseMessage?.content || 
                   kiroData.content || 
                   JSON.stringify(kiroData);
    
    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: config.model.target_model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: content
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    };
  }
}

// 调用 Kiro API
async function callKiroAPI(requestData, stream) {
  const headers = {
    'Authorization': `Bearer ${authData.accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': `AWS-Toolkit-For-VSCode/${KIRO_VERSION}`,
    'x-amz-codewhisperer-optout': 'false',
    'x-amzn-codewhisperer-device-id': deviceUUID,
    'Connection': 'close'  // 参考 AIClient-2-API 的设置
  };
  
  const url = `${KIRO_API_BASE}/generateAssistantResponse`;
  
  return axios.post(url, requestData, {
    headers,
    responseType: stream ? 'stream' : 'arraybuffer',  // 非流式也用 arraybuffer，因为返回的是二进制
    timeout: 120000,
    httpAgent,
    httpsAgent,
    proxy: false  // 禁用代理
  });
}

// 启动服务器
const PORT = config.server.port || 12321;
const HOST = config.server.host || '0.0.0.0';

app.listen(PORT, HOST, async () => {
  console.log('\n' + '='.repeat(48));
  console.log('🚀 Kiro Proxy 服务已启动');
  console.log('='.repeat(48));
  console.log(`监听地址: http://${HOST}:${PORT}`);
  console.log(`目标模型: ${config.model.target_model}`);
  if (authData.email) {
    console.log(`登录账号: ${authData.email}`);
  }
  
  // 启动时检查并刷新 Token
  const expiryDate = new Date(authData.expiresAt);
  const now = new Date();
  const timeUntilExpiry = expiryDate - now;
  const fiveMinutes = 5 * 60 * 1000;
  
  if (timeUntilExpiry < fiveMinutes) {
    console.log('\n⚠️  Token 即将过期或已过期');
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      console.log('✗ Token 刷新失败，请检查 refreshToken 是否有效');
    }
  } else {
    const hoursLeft = Math.floor(timeUntilExpiry / (1000 * 60 * 60));
    const minutesLeft = Math.floor((timeUntilExpiry % (1000 * 60 * 60)) / (1000 * 60));
    const expiresAtLocal = expiryDate.toLocaleString('zh-CN', { hour12: false });
    console.log(`Token 状态: ✓ 有效 (剩余 ${hoursLeft} 小时 ${minutesLeft} 分钟)`);
    console.log(`过期时间: ${expiresAtLocal}`);
  }
  
  // 查询并显示用量信息
  try {
    const usageUrl = `${KIRO_API_BASE}/getUsageLimits`;
    const params = new URLSearchParams({
      isEmailRequired: 'true',
      origin: 'AI_EDITOR',
      resourceType: 'AGENTIC_REQUEST'
    });
    
    const response = await axios.get(`${usageUrl}?${params.toString()}`, {
      headers: {
        'Authorization': `Bearer ${authData.accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': `AWS-Toolkit-For-VSCode/${KIRO_VERSION}`,
        'x-amz-codewhisperer-optout': 'false',
        'x-amzn-codewhisperer-device-id': deviceUUID
      },
      timeout: 10000,
      httpAgent,
      httpsAgent,
      proxy: false
    });
    
    const data = response.data;
    const usage = data.usageBreakdownList?.[0];
    const freeTrialInfo = usage?.freeTrialInfo;
    
    if (freeTrialInfo) {
      const used = freeTrialInfo.currentUsageWithPrecision || freeTrialInfo.currentUsage;
      const limit = freeTrialInfo.usageLimitWithPrecision || freeTrialInfo.usageLimit;
      const remaining = limit - used;
      const percentage = ((used / limit) * 100).toFixed(1);
      
      console.log(`\n💳 免费试用额度:`);
      console.log(`   已用: ${used.toFixed(2)} / ${limit} Credits (${percentage}%)`);
      console.log(`   剩余: ${remaining.toFixed(2)} Credits`);
      
      const expiryDate = new Date(freeTrialInfo.freeTrialExpiry * 1000);
      console.log(`   到期: ${expiryDate.toLocaleString('zh-CN')}`);
      
      if (remaining <= 0) {
        console.log(`   ⚠️  免费试用额度已用尽`);
      }
    }
    
    if (usage) {
      const monthlyLimit = usage.usageLimitWithPrecision || usage.usageLimit;
      const monthlyUsed = usage.currentUsageWithPrecision || usage.currentUsage;
      const monthlyRemaining = monthlyLimit - monthlyUsed;
      const monthlyPercentage = ((monthlyUsed / monthlyLimit) * 100).toFixed(1);
      
      console.log(`\n📊 月度额度:`);
      console.log(`   限额: ${monthlyLimit} Credits/月`);
      console.log(`   已用: ${monthlyUsed.toFixed(2)} Credits (${monthlyPercentage}%)`);
      console.log(`   剩余: ${monthlyRemaining.toFixed(2)} Credits`);
      
      if (monthlyRemaining < 5) {
        console.log(`   🚨 警告: 月度额度即将耗尽！`);
      } else if (monthlyRemaining < 15) {
        console.log(`   ⚠️  提示: 月度额度较低`);
      }
      
      if (usage.nextDateReset) {
        const resetDate = new Date(usage.nextDateReset * 1000);
        console.log(`   重置时间: ${resetDate.toLocaleString('zh-CN')}`);
      }
    }
  } catch (err) {
    console.log(`\n⚠️  无法查询用量信息: ${err.message}`);
  }
  
  console.log('\n' + '='.repeat(48));
  console.log('✅ 服务就绪');
  console.log('='.repeat(48));
});
