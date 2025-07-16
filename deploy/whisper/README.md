# Whisper 转录服务

这是一个基于 Replicate Whisper API 的音频转录服务，集成到 Heygem 项目中。

## 功能特性

- 支持多种音频格式的转录
- 返回带时间轴的转录结果
- 提供 RESTful API 接口
- 集成到 TTS-to-Video 工作流中

## 配置要求

### 1. 获取 Replicate API Token

1. 访问 [Replicate](https://replicate.com/account/api-tokens)
2. 注册账号并获取 API Token
3. 在 `/deploy` 目录下创建 `.env` 文件：

```bash
REPLICATE_API_TOKEN=your_replicate_api_token_here
```

### 2. Docker 部署

服务已集成到 `docker-compose.yml` 中，运行以下命令启动：

```bash
cd /deploy
docker-compose up -d
```

## API 接口

### 健康检查

```http
GET http://localhost:3001/health
```

响应：
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 音频转录

```http
POST http://localhost:3001/transcribe
Content-Type: application/json

{
  "audio_url": "https://example.com/audio.wav"
}
```

响应：
```json
{
  "success": true,
  "data": {
    "text": "完整的转录文本",
    "language": "zh",
    "segments": [
      {
        "start": 0.0,
        "end": 2.5,
        "text": "第一段文本"
      },
      {
        "start": 2.5,
        "end": 5.0,
        "text": "第二段文本"
      }
    ]
  }
}
```

## 集成到工作流

在 TTS-to-Video 工作流中，转录服务会在以下阶段被调用：

1. **TTS 阶段**：生成音频文件
2. **转录阶段**：调用 Whisper 服务转录音频
3. **视频阶段**：生成视频文件

转录结果会包含在最终的任务结果中：

```json
{
  "status": "completed",
  "ttsResult": { ... },
  "transcriptionResult": {
    "text": "转录的完整文本",
    "language": "zh",
    "segments": [ ... ]
  },
  "videoPath": "/path/to/video.mp4"
}
```

## 测试

使用提供的测试脚本验证服务：

```bash
cd /deploy/queue-service
node test-whisper.js
```

## 注意事项

1. **网络要求**：音频文件必须通过公网 URL 访问
2. **超时设置**：转录可能需要较长时间，默认超时 3 分钟
3. **错误处理**：转录失败不会影响视频生成流程
4. **费用**：Replicate API 按使用量计费，请注意成本控制

## 故障排除

### 常见问题

1. **API Token 错误**
   - 检查 `.env` 文件中的 `REPLICATE_API_TOKEN` 是否正确
   - 确认 Token 有效且有足够的配额

2. **音频文件无法访问**
   - 确认音频 URL 可以公网访问
   - 检查 nginx 配置中的 `/audios/` 路由

3. **服务启动失败**
   - 检查 Docker 容器日志：`docker logs heygem-whisper`
   - 确认端口 3001 未被占用

4. **转录超时**
   - 检查网络连接
   - 考虑增加超时时间
   - 确认音频文件大小合理