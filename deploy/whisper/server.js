import express from 'express';
import Replicate from 'replicate';
import dotenv from 'dotenv';
import cors from 'cors';

// 加载环境变量
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json());

// 初始化 Replicate 客户端
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// 健康检查接口
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 音频转录接口
app.post('/transcribe', async (req, res) => {
  try {
    const { audio_url } = req.body;
    
    if (!audio_url) {
      return res.status(400).json({
        success: false,
        error: 'audio_url is required'
      });
    }

    console.log(`Starting transcription for audio: ${audio_url}`);
    
    const input = {
      audio: audio_url
    };

    const output = await replicate.run(
      "openai/whisper:8099696689d249cf8b122d833c36ac3f75505c666a395ca40ef26f68e7d3d16e",
      { input }
    );

    // 格式化返回结果
    const transcription = {
      text: output.text || '',
      segments: output.segments ? output.segments.map(segment => ({
        start: parseFloat(segment.start.toFixed(2)),
        end: parseFloat(segment.end.toFixed(2)),
        text: segment.text.trim()
      })) : [],
      language: output.language || 'unknown'
    };

    console.log(`Transcription completed for audio: ${audio_url}`);
    
    res.json({
      success: true,
      data: transcription
    });
    
  } catch (error) {
    console.error('Transcription error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Whisper service running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Transcribe API: http://localhost:${PORT}/transcribe`);
});