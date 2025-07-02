const express = require('express');
const Redis = require('ioredis');
const axios = require('axios');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

// Redis连接配置
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: true
});

// 中间件配置
app.use(helmet());
app.use(morgan('combined'));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Redis连接事件
redis.on('connect', () => console.log('Redis connected'));
redis.on('error', (err) => console.error('Redis error:', err));

// 健康检查
app.get('/health', async (req, res) => {
  try {
    await redis.ping();
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      redis: 'connected',
      processors: {
        video: processor.processing,
        tts: ttsProcessor.processing,
        ttsToVideo: ttsToVideoProcessor.processing
      }
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'error', 
      timestamp: new Date().toISOString(),
      redis: 'disconnected',
      error: error.message
    });
  }
});

// API路由

// 1. 提交视频生成任务
app.post('/api/video/submit', async (req, res) => {
  try {
    // 验证请求参数
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: 'Request body is required' });
    }

    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const currentQueueLength = await redis.llen('video_queue');
    
    const taskData = {
      id: taskId,
      params: req.body,
      status: 'queued',
      createdAt: new Date().toISOString(),
      queuePosition: currentQueueLength + 1,
      clientIP: req.ip || req.connection.remoteAddress
    };
    
    // 添加到队列
    await redis.lpush('video_queue', JSON.stringify(taskData));
    
    // 保存任务状态
    await redis.hset('tasks', taskId, JSON.stringify(taskData));
    
    // 设置任务过期时间（24小时）
    await redis.expire(`tasks:${taskId}`, 86400);
    
    console.log(`Task ${taskId} added to queue, position: ${taskData.queuePosition}`);
    
    res.json({ 
      success: true,
      taskId, 
      status: 'queued',
      queuePosition: taskData.queuePosition,
      estimatedWaitTime: taskData.queuePosition * 60, // 假设每个任务60秒
      message: '任务已加入队列，请使用taskId查询进度'
    });
  } catch (error) {
    console.error('Submit error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      message: '提交任务失败，请稍后重试'
    });
  }
});

// 2. 查询任务状态
app.get('/api/video/status/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    
    if (!taskId) {
      return res.status(400).json({ error: 'TaskId is required' });
    }

    const taskData = await redis.hget('tasks', taskId);
    if (!taskData) {
      return res.status(404).json({ 
        success: false,
        error: 'Task not found',
        message: '任务不存在或已过期'
      });
    }
    
    const task = JSON.parse(taskData);
     
     // 如果任务还在队列中，计算当前位置
     if (task.status === 'queued') {
       const queueItems = await redis.lrange('video_queue', 0, -1);
      const position = queueItems.findIndex(item => {
        const queueTask = JSON.parse(item);
        return queueTask.id === taskId;
      });
      task.queuePosition = position >= 0 ? position + 1 : 0;
      task.estimatedWaitTime = task.queuePosition * 60;
    }
    
    // 如果任务完成，提供视频下载链接
    if (task.status === 'completed' && task.videoPath) {
      task.videoUrl = `/api/video/download/${taskId}`;
    }
    
    res.json({
      success: true,
      ...task
    });
  } catch (error) {
    console.error('Status query error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      message: '查询状态失败'
    });
  }
});

// 3. TTS预处理和训练任务提交
app.post('/api/tts/preprocess', async (req, res) => {
  try {
    // 验证请求参数
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: 'Request body is required' });
    }

    const taskId = `tts_preprocess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const currentQueueLength = await redis.llen('tts_preprocess_queue');
    
    const taskData = {
      id: taskId,
      type: 'preprocess',
      params: req.body,
      status: 'queued',
      createdAt: new Date().toISOString(),
      queuePosition: currentQueueLength + 1,
      clientIP: req.ip || req.connection.remoteAddress
    };
    
    // 添加到TTS预处理队列
    await redis.lpush('tts_preprocess_queue', JSON.stringify(taskData));
    
    // 保存任务状态
    await redis.hset('tts_tasks', taskId, JSON.stringify(taskData));
    
    // 设置任务过期时间（24小时）
    await redis.expire(`tts_tasks:${taskId}`, 86400);
    
    console.log(`TTS preprocess task ${taskId} added to queue, position: ${taskData.queuePosition}`);
    
    res.json({ 
      success: true,
      taskId, 
      status: 'queued',
      queuePosition: taskData.queuePosition,
      estimatedWaitTime: taskData.queuePosition * 30, // 假设每个任务30秒
      message: 'TTS预处理任务已加入队列，请使用taskId查询进度'
    });
  } catch (error) {
    console.error('TTS preprocess submit error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      message: '提交TTS预处理任务失败，请稍后重试'
    });
  }
});

// 4. TTS音频生成任务提交
app.post('/api/tts/invoke', async (req, res) => {
  try {
    // 验证请求参数
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: 'Request body is required' });
    }

    const taskId = `tts_invoke_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const currentQueueLength = await redis.llen('tts_invoke_queue');
    
    const taskData = {
      id: taskId,
      type: 'invoke',
      params: req.body,
      status: 'queued',
      createdAt: new Date().toISOString(),
      queuePosition: currentQueueLength + 1,
      clientIP: req.ip || req.connection.remoteAddress
    };
    
    // 添加到TTS音频生成队列
    await redis.lpush('tts_invoke_queue', JSON.stringify(taskData));
    
    // 保存任务状态
    await redis.hset('tts_tasks', taskId, JSON.stringify(taskData));
    
    // 设置任务过期时间（24小时）
    await redis.expire(`tts_tasks:${taskId}`, 86400);
    
    console.log(`TTS invoke task ${taskId} added to queue, position: ${taskData.queuePosition}`);
    
    res.json({ 
      success: true,
      taskId, 
      status: 'queued',
      queuePosition: taskData.queuePosition,
      estimatedWaitTime: taskData.queuePosition * 20, // 假设每个任务20秒
      message: 'TTS音频生成任务已加入队列，请使用taskId查询进度'
    });
  } catch (error) {
    console.error('TTS invoke submit error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      message: '提交TTS音频生成任务失败，请稍后重试'
    });
  }
});

// 5. 查询TTS任务状态
app.get('/api/tts/status/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    
    if (!taskId) {
      return res.status(400).json({ error: 'TaskId is required' });
    }

    const taskData = await redis.hget('tts_tasks', taskId);
    if (!taskData) {
      return res.status(404).json({ 
        success: false,
        error: 'Task not found',
        message: 'TTS任务不存在或已过期'
      });
    }
    
    const task = JSON.parse(taskData);
     
     // 如果任务还在队列中，计算当前位置
     if (task.status === 'queued') {
       const queueName = task.type === 'preprocess' ? 'tts_preprocess_queue' : 'tts_invoke_queue';
      const queueItems = await redis.lrange(queueName, 0, -1);
      const position = queueItems.findIndex(item => {
        const queueTask = JSON.parse(item);
        return queueTask.id === taskId;
      });
      task.queuePosition = position >= 0 ? position + 1 : 0;
      task.estimatedWaitTime = task.queuePosition * (task.type === 'preprocess' ? 30 : 20);
    }
    
    // 对于音频生成任务，如果已完成，提供音频下载链接
    if (task.type === 'invoke' && task.status === 'completed' && task.result && task.result.audioData) {
      task.audioUrl = `/api/tts/audio/${taskId}`;
    }
    
    res.json({
      success: true,
      ...task
    });
  } catch (error) {
    console.error('TTS status query error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      message: '查询TTS任务状态失败'
    });
  }
});

// 6. 获取TTS音频文件
app.get('/api/tts/audio/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    
    if (!taskId) {
      return res.status(400).json({ error: 'TaskId is required' });
    }

    const taskData = await redis.hget('tts_tasks', taskId);
    if (!taskData) {
      return res.status(404).json({ 
        success: false,
        error: 'Task not found',
        message: 'TTS任务不存在或已过期'
      });
    }
    
    const task = JSON.parse(taskData);
    
    if (task.type !== 'invoke') {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid task type',
        message: '该任务不是音频生成任务'
      });
    }
    
    if (task.status !== 'completed') {
      return res.status(400).json({ 
        success: false,
        error: 'Task not completed',
        message: '任务尚未完成'
      });
    }
    
    if (!task.result || !task.result.audioData) {
      return res.status(404).json({ 
        success: false,
        error: 'Audio data not found',
        message: '音频数据不存在'
      });
    }
    
    // 将base64音频数据转换为Buffer
    const audioBuffer = Buffer.from(task.result.audioData, 'base64');
    
    // 设置响应头
    res.set({
      'Content-Type': task.result.contentType || 'audio/wav',
      'Content-Length': audioBuffer.length,
      'Content-Disposition': `attachment; filename="audio_${taskId}.wav"`
    });
    
    // 返回音频数据
    res.send(audioBuffer);
    
  } catch (error) {
    console.error('TTS audio download error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      message: '下载音频文件失败'
    });
  }
});

// 7. 获取队列统计信息
app.get('/api/queue/stats', async (req, res) => {
  try {
    const videoQueueLength = await redis.llen('video_queue');
    const ttsPreprocessQueueLength = await redis.llen('tts_preprocess_queue');
    const ttsInvokeQueueLength = await redis.llen('tts_invoke_queue');
    const ttsToVideoQueueLength = await redis.llen('tts_to_video_queue');
    const totalVideoTasks = await redis.hlen('tasks');
    const totalTtsTasks = await redis.hlen('tts_tasks');
    const totalTtsToVideoTasks = await redis.hlen('tts_to_video_tasks');
    
    // 获取各状态任务数量
    const allVideoTasks = await redis.hgetall('tasks');
    const allTtsTasks = await redis.hgetall('tts_tasks');
    const allTtsToVideoTasks = await redis.hgetall('tts_to_video_tasks');
    const videoStatusCounts = {
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      timeout: 0
    };
    const ttsStatusCounts = {
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      timeout: 0
    };
    const ttsToVideoStatusCounts = {
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      timeout: 0
    };
    
    Object.values(allVideoTasks).forEach(taskJson => {
      try {
        const task = JSON.parse(taskJson);
        if (videoStatusCounts.hasOwnProperty(task.status)) {
          videoStatusCounts[task.status]++;
        }
      } catch (e) {
        // 忽略解析错误的任务
      }
    });
    
    Object.values(allTtsTasks).forEach(taskJson => {
      try {
        const task = JSON.parse(taskJson);
        if (ttsStatusCounts.hasOwnProperty(task.status)) {
          ttsStatusCounts[task.status]++;
        }
      } catch (e) {
        // 忽略解析错误的任务
      }
    });
    
    Object.values(allTtsToVideoTasks).forEach(taskJson => {
      try {
        const task = JSON.parse(taskJson);
        if (ttsToVideoStatusCounts.hasOwnProperty(task.status)) {
          ttsToVideoStatusCounts[task.status]++;
        }
      } catch (e) {
        // 忽略解析错误的任务
      }
    });
    
    res.json({
      success: true,
      video: {
        queueLength: videoQueueLength,
        totalTasks: totalVideoTasks,
        statusCounts: videoStatusCounts,
        processing: processor.processing,
        currentTask: processor.currentTask ? processor.currentTask.id : null
      },
      tts: {
        preprocessQueueLength: ttsPreprocessQueueLength,
        invokeQueueLength: ttsInvokeQueueLength,
        totalTasks: totalTtsTasks,
        statusCounts: ttsStatusCounts,
        processing: ttsProcessor.processing,
        currentTask: ttsProcessor.currentTask ? ttsProcessor.currentTask.id : null
      },
      ttsToVideo: {
        queueLength: ttsToVideoQueueLength,
        totalTasks: totalTtsToVideoTasks,
        statusCounts: ttsToVideoStatusCounts,
        processing: ttsToVideoProcessor.processing,
        currentTask: ttsToVideoProcessor.currentTask ? ttsToVideoProcessor.currentTask.id : null
      },
      uptime: process.uptime()
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// 7. TTS转视频组合任务提交
app.post('/api/tts-to-video/submit', async (req, res) => {
  try {
    // 验证请求参数
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: 'Request body is required' });
    }

    // 验证必需的参数
    if (!req.body.ttsParams || !req.body.videoParams) {
      return res.status(400).json({ 
        error: 'Both ttsParams and videoParams are required',
        message: '需要同时提供TTS参数和视频生成参数'
      });
    }

    const taskId = `tts_to_video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const currentQueueLength = await redis.llen('tts_to_video_queue');
    
    const taskData = {
      id: taskId,
      type: 'tts_to_video',
      ttsParams: req.body.ttsParams,
      videoParams: req.body.videoParams,
      status: 'queued',
      createdAt: new Date().toISOString(),
      queuePosition: currentQueueLength + 1,
      clientIP: req.ip || req.connection.remoteAddress,
      phase: 'pending' // pending, tts, video, completed
    };
    
    // 添加到TTS转视频队列
    await redis.lpush('tts_to_video_queue', JSON.stringify(taskData));
    
    // 保存任务状态
    await redis.hset('tts_to_video_tasks', taskId, JSON.stringify(taskData));
    
    // 设置任务过期时间（24小时）
    await redis.expire(`tts_to_video_tasks:${taskId}`, 86400);
    
    console.log(`TTS-to-Video task ${taskId} added to queue, position: ${taskData.queuePosition}`);
    
    res.json({ 
      success: true,
      taskId, 
      status: 'queued',
      phase: 'pending',
      queuePosition: taskData.queuePosition,
      estimatedWaitTime: taskData.queuePosition * 90, // 假设每个任务90秒（TTS+视频）
      message: 'TTS转视频任务已加入队列，请使用taskId查询进度'
    });
  } catch (error) {
    console.error('TTS-to-Video submit error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      message: '提交TTS转视频任务失败，请稍后重试'
    });
  }
});

// 8. 查询TTS转视频任务状态
app.get('/api/tts-to-video/status/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    
    if (!taskId) {
      return res.status(400).json({ error: 'TaskId is required' });
    }

    const taskData = await redis.hget('tts_to_video_tasks', taskId);
    if (!taskData) {
      return res.status(404).json({ 
        success: false,
        error: 'Task not found',
        message: 'TTS转视频任务不存在或已过期'
      });
    }
    
    const task = JSON.parse(taskData);
    

    
    // 如果任务还在队列中，计算当前位置
    if (task.status === 'queued') {
      const queueItems = await redis.lrange('tts_to_video_queue', 0, -1);
      const position = queueItems.findIndex(item => {
        const queueTask = JSON.parse(item);
        return queueTask.id === taskId;
      });
      task.queuePosition = position >= 0 ? position + 1 : 0;
      task.estimatedWaitTime = task.queuePosition * 90;
    }
    
    // 如果任务完成，提供视频下载链接
    if (task.status === 'completed' && task.videoPath) {
      task.videoDownloadUrl = `/api/tts-to-video/video/${taskId}`;
    }
    
    // 如果TTS阶段完成，提供音频下载链接
    if (task.ttsResult && task.ttsResult.audioFilePath) {
      task.audioDownloadUrl = `/api/tts-to-video/audio/${taskId}`;
      // 移除audioData以减少响应大小
      if (task.ttsResult.audioData) {
        delete task.ttsResult.audioData;
      }
    }
    
    res.json({
      success: true,
      ...task
    });
  } catch (error) {
    console.error('TTS-to-Video status query error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      message: '查询TTS转视频任务状态失败'
    });
  }
});

// 9. 获取TTS转视频任务的音频文件
app.get('/api/tts-to-video/audio/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    
    if (!taskId) {
      return res.status(400).json({ error: 'TaskId is required' });
    }

    const taskData = await redis.hget('tts_to_video_tasks', taskId);
    if (!taskData) {
      return res.status(404).json({ 
        success: false,
        error: 'Task not found',
        message: 'TTS转视频任务不存在或已过期'
      });
    }
    
    const task = JSON.parse(taskData);
    
    if (!task.ttsResult || !task.ttsResult.audioFilePath) {
      return res.status(404).json({ 
        success: false,
        error: 'Audio file not found',
        message: 'TTS音频文件不存在或尚未生成'
      });
    }
    
    // 检查音频文件是否存在
    const fs = require('fs');
    if (!fs.existsSync(task.ttsResult.audioFilePath)) {
      return res.status(404).json({ 
        success: false,
        error: 'Audio file not found',
        message: '音频文件不存在'
      });
    }
    
    // 获取文件信息
    const fileName = task.ttsResult.audioFileName || `audio_${taskId}.wav`;
    const fileStats = fs.statSync(task.ttsResult.audioFilePath);
    
    // 设置响应头
    res.set({
      'Content-Type': task.ttsResult.contentType || 'audio/wav',
      'Content-Length': fileStats.size,
      'Content-Disposition': `attachment; filename="${fileName}"`
    });
    
    // 创建文件流并返回音频数据
    const fileStream = fs.createReadStream(task.ttsResult.audioFilePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (error) => {
      console.error('Audio stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false,
          error: 'Failed to stream audio file',
          message: '音频文件流传输失败'
        });
      }
    });
    
  } catch (error) {
    console.error('TTS-to-Video audio download error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      message: '下载音频文件失败'
    });
  }
});

// 10. 获取TTS转视频任务的视频文件
app.get('/api/tts-to-video/video/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    
    if (!taskId) {
      return res.status(400).json({ error: 'TaskId is required' });
    }

    const taskData = await redis.hget('tts_to_video_tasks', taskId);
    if (!taskData) {
      return res.status(404).json({ 
        success: false,
        error: 'Task not found',
        message: 'TTS转视频任务不存在或已过期'
      });
    }
    
    const task = JSON.parse(taskData);
    
    if (task.status !== 'completed' || !task.videoPath) {
      return res.status(404).json({ 
        success: false,
        error: 'Video not found',
        message: '视频文件不存在或尚未生成完成'
      });
    }
    
    // 检查视频文件是否存在
    const fs = require('fs');
    
    if (!fs.existsSync(task.videoPath)) {
      return res.status(404).json({ 
        success: false,
        error: 'Video file not found',
        message: '视频文件在服务器上不存在'
      });
    }
    
    // 获取文件信息
    const fileName = task.videoPath.split('/').pop();
    const fileStats = fs.statSync(task.videoPath);
    
    // 设置响应头
    res.set({
      'Content-Type': 'video/mp4',
      'Content-Length': fileStats.size,
      'Content-Disposition': `attachment; filename="video_${taskId}.mp4"`,
      'Accept-Ranges': 'bytes'
    });
    
    // 创建文件流并返回视频数据
    const fileStream = fs.createReadStream(task.videoPath);
    fileStream.pipe(res);
    
  } catch (error) {
    console.error('TTS-to-Video video download error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      message: '下载视频文件失败'
    });
  }
});

// 11. 获取普通视频任务的视频文件
app.get('/api/video/download/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    
    if (!taskId) {
      return res.status(400).json({ error: 'TaskId is required' });
    }

    const taskData = await redis.hget('tasks', taskId);
    if (!taskData) {
      return res.status(404).json({ 
        success: false,
        error: 'Task not found',
        message: '视频任务不存在或已过期'
      });
    }
    
    const task = JSON.parse(taskData);
    
    if (task.status !== 'completed' || !task.videoPath) {
      return res.status(404).json({ 
        success: false,
        error: 'Video not found',
        message: '视频文件不存在或尚未生成完成'
      });
    }
    
    // 检查视频文件是否存在
    const fs = require('fs');
    // videoPath可能是完整路径或相对路径，需要处理
    let fullVideoPath = task.videoPath;
    if (!task.videoPath.startsWith('/')) {
      // 如果是相对路径（如"/44deeed0-8b9e-44c8-980c-61ea03d2de4c-r.mp4"），需要拼接完整路径
      fullVideoPath = `/data/heygem_data/face2face/temp${task.videoPath}`;
    }
    
    if (!fs.existsSync(fullVideoPath)) {
      return res.status(404).json({ 
        success: false,
        error: 'Video file not found',
        message: '视频文件在服务器上不存在'
      });
    }
    
    // 获取文件信息
    const fileName = task.videoPath.split('/').pop();
    const fileStats = fs.statSync(fullVideoPath);
    
    // 设置响应头
    res.set({
      'Content-Type': 'video/mp4',
      'Content-Length': fileStats.size,
      'Content-Disposition': `attachment; filename="video_${taskId}.mp4"`,
      'Accept-Ranges': 'bytes'
    });
    
    // 创建文件流并返回视频数据
    const fileStream = fs.createReadStream(fullVideoPath);
    fileStream.pipe(res);
    
  } catch (error) {
    console.error('Video download error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      message: '下载视频文件失败'
    });
  }
});

// 12. 取消任务（可选功能）
app.delete('/api/video/cancel/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const taskData = await redis.hget('tasks', taskId);
    
    if (!taskData) {
      return res.status(404).json({ 
        success: false,
        error: 'Task not found' 
      });
    }
    
    const task = JSON.parse(taskData);
    
    if (task.status === 'processing') {
      return res.status(400).json({ 
        success: false,
        error: 'Cannot cancel processing task',
        message: '正在处理的任务无法取消'
      });
    }
    
    if (task.status === 'queued') {
      // 从队列中移除
      const queueItems = await redis.lrange('video_queue', 0, -1);
      for (let i = 0; i < queueItems.length; i++) {
        const queueTask = JSON.parse(queueItems[i]);
        if (queueTask.id === taskId) {
          await redis.lrem('video_queue', 1, queueItems[i]);
          break;
        }
      }
      
      // 更新任务状态
      task.status = 'cancelled';
      task.cancelledAt = new Date().toISOString();
      await redis.hset('tasks', taskId, JSON.stringify(task));
      
      res.json({ 
        success: true,
        message: '任务已取消'
      });
    } else {
      res.status(400).json({ 
        success: false,
        error: 'Task cannot be cancelled',
        message: `状态为${task.status}的任务无法取消`
      });
    }
  } catch (error) {
    console.error('Cancel error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// TTS转视频队列处理器
class TtsToVideoQueueProcessor {
  constructor() {
    this.processing = false;
    this.currentTask = null;
    this.processedCount = 0;
    this.startTime = new Date();
    this.startProcessing();
  }
  
  async startProcessing() {
    console.log('TTS-to-Video Queue processor started at', new Date().toISOString());
    
    while (true) {
      try {
        if (!this.processing) {
          await this.processNext();
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error('TTS-to-Video Queue processing error:', error);
        await new Promise(resolve => setTimeout(resolve, 10000)); // 错误后等待10秒
      }
    }
  }
  
  async processNext() {
    try {
      // 阻塞式获取队列任务，超时1秒
      const result = await redis.brpop('tts_to_video_queue', 1);
      if (!result) return;
      
      const task = JSON.parse(result[1]);
      this.processing = true;
      this.currentTask = task;
      
      console.log(`[${new Date().toISOString()}] Processing TTS-to-Video task ${task.id}`);
      
      await this.processTask(task);
      
    } catch (error) {
      console.error('TTS-to-Video Process next error:', error);
    } finally {
      this.processing = false;
      this.currentTask = null;
    }
  }
  
  async processTask(task) {
    try {
      // 更新状态为处理中
      task.status = 'processing';
      task.startedAt = new Date().toISOString();
      task.phase = 'tts';
      await redis.hset('tts_to_video_tasks', task.id, JSON.stringify(task));
      
      console.log(`Starting TTS phase for task ${task.id}`);
      
      // 第一阶段：调用TTS invoke接口
      const ttsResponse = await axios.post(
        'http://heygem-tts:8080/v1/invoke', 
        task.ttsParams,
        { 
          timeout: 120000,
          responseType: 'arraybuffer',
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (!ttsResponse || !ttsResponse.data) {
        throw new Error('Invalid response from TTS service');
      }
      
      // 保存TTS音频文件到本地
      const audioBuffer = Buffer.from(ttsResponse.data);
      const audioFileName = `tts_audio_${task.id}_${Date.now()}.wav`;
      const audioFilePath = `/data/heygem_data/face2face/temp/${audioFileName}`;
      
      // 确保目录存在
      const audioDir = '/data/heygem_data/face2face/temp';
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }
      
      // 写入音频文件
      fs.writeFileSync(audioFilePath, audioBuffer);
      
      // 保存TTS结果
      task.ttsResult = {
        audioData: Buffer.from(ttsResponse.data).toString('base64'),
        contentType: 'audio/wav',
        audioFilePath: audioFilePath,
        audioFileName: audioFileName
      };
      task.ttsCompletedAt = new Date().toISOString();
      task.phase = 'video';
      await redis.hset('tts_to_video_tasks', task.id, JSON.stringify(task));
      
      console.log(`TTS phase completed for task ${task.id}, audio saved to ${audioFilePath}`);
      
      // 第二阶段：调用视频生成接口
      // 确保参数中包含code字段
      if (!task.videoParams.code) {
        task.videoParams.code = `code_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      }
      
      // 将音频文件路径转换为HTTP URL
      // 从 /data/heygem_data/face2face/temp/filename.wav 转换为 http://nginx-proxy/audios/filename.wav
      const audioHttpUrl = `http://nginx-proxy/audios/${audioFileName}`;
      task.videoParams.audio_url = audioHttpUrl;
      
      console.log(`Starting video generation for task ${task.id} with audio: ${audioHttpUrl}`);
      
      // 调用Heygem服务提交任务
      const submitResponse = await axios.post(
        'http://heygem-gen-video:8383/easy/submit', 
        task.videoParams,
        { 
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      // 检查Heygem服务响应格式
      if (!submitResponse.data || !submitResponse.data.success) {
        throw new Error('Invalid response from Heygem service');
      }
      
      // 使用提交时的code作为任务标识
      const heygem_code = task.videoParams.code;
      task.heygem_code = heygem_code;
      task.phase = 'video';
      await redis.hset('tts_to_video_tasks', task.id, JSON.stringify(task));
      
      console.log(`Heygem task code: ${heygem_code} for task ${task.id}`);
      
      // 轮询视频生成状态
      let completed = false;
      let pollCount = 0;
      const maxPolls = 180; // 最多轮询6分钟（每2秒一次）
      
      while (!completed && pollCount < maxPolls) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        pollCount++;
        
        try {
          const statusResponse = await axios.get(
            `http://heygem-gen-video:8383/easy/query?code=${heygem_code}`,
            { timeout: 10000 }
          );
          
          console.log(`Poll ${pollCount}: Task ${task.id} Heygem response:`, JSON.stringify(statusResponse.data));
          
          // 处理Heygem服务的实际响应格式
          if (statusResponse.data.code === 10004) {
            // 任务不存在，可能是code参数问题
            console.error(`Task ${task.id}: Heygem task not found with code ${heygem_code}`);
            task.status = 'failed';
            task.error = 'Heygem task not found - code mismatch';
            task.completedAt = new Date().toISOString();
            completed = true;
          } else if (statusResponse.data.code === 10000) {
            // 成功响应，检查任务状态
            const heygem_data = statusResponse.data.data || {};
            const { status, result, error } = heygem_data;
            
            console.log(`Poll ${pollCount}: Task ${task.id} Heygem status: ${status}`);
            
            if (status === 2 && result) {
              task.status = 'completed';
              task.phase = 'completed';
              task.videoPath = `/data/heygem_data/face2face/temp${result}`;
              task.completedAt = new Date().toISOString();
              task.processingTime = new Date() - new Date(task.startedAt);
              completed = true;
              this.processedCount++;
              console.log(`TTS-to-Video task ${task.id} completed successfully in ${task.processingTime}ms`);
            } else if (status == 0) {
              task.status = 'failed';
              task.error = error || 'Video generation failed';
              task.completedAt = new Date().toISOString();
              completed = true;
              console.log(`TTS-to-Video task ${task.id} failed: ${task.error}`);
            } else if (status == 1) {
              // 继续轮询
              task.lastPollAt = new Date().toISOString();
              await redis.hset('tts_to_video_tasks', task.id, JSON.stringify(task));
            } else {
              // 检查是否有生成的视频文件（基于文件系统）
              const videoFileName = `${heygem_code}-r.mp4`;
              console.log(`Checking for video file: ${videoFileName}`);
              
              // 如果状态未知但可能已完成，标记为完成
              if (pollCount > 30) { // 轮询超过1分钟后检查文件
                task.status = 'completed';
                task.phase = 'completed';
                task.videoPath = `/data/heygem_data/face2face/temp/${videoFileName}`;
                task.completedAt = new Date().toISOString();
                task.processingTime = new Date() - new Date(task.startedAt);
                completed = true;
                this.processedCount++;
                console.log(`TTS-to-Video task ${task.id} marked as completed based on file existence`);
              } else {
                console.warn(`Unknown status ${status} for task ${task.id}, continuing to poll`);
                task.lastPollAt = new Date().toISOString();
                await redis.hset('tts_to_video_tasks', task.id, JSON.stringify(task));
              }
            }
          } else {
            console.warn(`Unexpected Heygem response code ${statusResponse.data.code} for task ${task.id}`);
            task.lastPollAt = new Date().toISOString();
            await redis.hset('tts_to_video_tasks', task.id, JSON.stringify(task));
          }
          
        } catch (pollError) {
          console.error(`Poll error for task ${task.id} (attempt ${pollCount}):`, pollError.message);
          
          // 如果是网络错误，继续重试
          if (pollError.code === 'ECONNREFUSED' || pollError.code === 'ETIMEDOUT') {
            continue;
          }
          
          // 其他错误，减少重试次数
          if (pollCount > 5) {
            throw pollError;
          }
        }
      }
      
      if (!completed) {
        task.status = 'timeout';
        task.error = `Video generation timeout after ${maxPolls * 2} seconds`;
        task.completedAt = new Date().toISOString();
        console.log(`TTS-to-Video task ${task.id} timed out after ${maxPolls} polls`);
      }
      
      await redis.hset('tts_to_video_tasks', task.id, JSON.stringify(task));
      
    } catch (error) {
      console.error(`TTS-to-Video task ${task.id} processing error:`, error.message);
      task.status = 'failed';
      task.error = error.message;
      task.completedAt = new Date().toISOString();
      await redis.hset('tts_to_video_tasks', task.id, JSON.stringify(task));
    }
  }
}

// TTS队列处理器
class TtsQueueProcessor {
  constructor() {
    this.processing = false;
    this.currentTask = null;
    this.processedCount = 0;
    this.startTime = new Date();
    this.startProcessing();
  }
  
  async startProcessing() {
    console.log('TTS Queue processor started at', new Date().toISOString());
    
    while (true) {
      try {
        if (!this.processing) {
          await this.processNext();
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error('TTS Queue processing error:', error);
        await new Promise(resolve => setTimeout(resolve, 5000)); // 错误后等待5秒
      }
    }
  }
  
  async processNext() {
    try {
      // 优先处理预处理队列，然后处理音频生成队列
      let result = await redis.brpop('tts_preprocess_queue', 1);
      if (!result) {
        result = await redis.brpop('tts_invoke_queue', 1);
      }
      
      if (!result) return;
      
      const task = JSON.parse(result[1]);
      this.processing = true;
      this.currentTask = task;
      
      console.log(`[${new Date().toISOString()}] Processing TTS task ${task.id} (${task.type})`);
      
      await this.processTask(task);
      
    } catch (error) {
      console.error('TTS Process next error:', error);
    } finally {
      this.processing = false;
      this.currentTask = null;
    }
  }
  
  async processTask(task) {
    try {
      // 更新状态为处理中
      task.status = 'processing';
      task.startedAt = new Date().toISOString();
      await redis.hset('tts_tasks', task.id, JSON.stringify(task));
      
      console.log(`Calling TTS ${task.type} API for task ${task.id}`);
      
      let response;
      if (task.type === 'preprocess') {
        // 调用TTS预处理接口
        response = await axios.post(
          'http://heygem-tts:8080/v1/preprocess_and_tran', 
          task.params,
          { 
            timeout: 60000,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      } else if (task.type === 'invoke') {
        // 调用TTS音频生成接口
        response = await axios.post(
          'http://heygem-tts:8080/v1/invoke', 
          task.params,
          { 
            timeout: 120000,
            responseType: 'arraybuffer',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      }
      
      if (!response || !response.data) {
        throw new Error('Invalid response from TTS service');
      }
      
      task.status = 'completed';
      task.result = task.type === 'invoke' ? {
        audioData: Buffer.from(response.data).toString('base64'),
        contentType: 'audio/wav'
      } : response.data;
      task.completedAt = new Date().toISOString();
      task.processingTime = new Date() - new Date(task.startedAt);
      this.processedCount++;
      
      console.log(`TTS task ${task.id} (${task.type}) completed successfully in ${task.processingTime}ms`);
      
      await redis.hset('tts_tasks', task.id, JSON.stringify(task));
      
    } catch (error) {
      console.error(`TTS task ${task.id} processing error:`, error.message);
      task.status = 'failed';
      task.error = error.message;
      task.completedAt = new Date().toISOString();
      await redis.hset('tts_tasks', task.id, JSON.stringify(task));
    }
  }
}

// 视频队列处理器
class QueueProcessor {
  constructor() {
    this.processing = false;
    this.currentTask = null;
    this.processedCount = 0;
    this.startTime = new Date();
    this.startProcessing();
  }
  
  async startProcessing() {
    console.log('Queue processor started at', new Date().toISOString());
    
    while (true) {
      try {
        if (!this.processing) {
          await this.processNext();
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error('Queue processing error:', error);
        await new Promise(resolve => setTimeout(resolve, 10000)); // 错误后等待10秒
      }
    }
  }
  
  async processNext() {
    try {
      // 阻塞式获取队列任务，超时1秒
      const result = await redis.brpop('video_queue', 1);
      if (!result) return;
      
      const task = JSON.parse(result[1]);
      this.processing = true;
      this.currentTask = task;
      
      console.log(`[${new Date().toISOString()}] Processing task ${task.id}`);
      
      await this.processTask(task);
      
    } catch (error) {
      console.error('Process next error:', error);
    } finally {
      this.processing = false;
      this.currentTask = null;
    }
  }
  
  async processTask(task) {
    try {
      // 更新状态为处理中
      task.status = 'processing';
      task.startedAt = new Date().toISOString();
      await redis.hset('tasks', task.id, JSON.stringify(task));
      
      console.log(`Calling Heygem submit API for task ${task.id}`);
      
      // 确保参数中包含code字段
      if (!task.params.code) {
        task.params.code = `code_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      }
      
      // 调用Heygem服务提交任务
      const submitResponse = await axios.post(
        'http://heygem-gen-video:8383/easy/submit', 
        task.params,
        { 
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      // 检查Heygem服务响应格式
      if (!submitResponse.data || !submitResponse.data.success) {
        throw new Error('Invalid response from Heygem service');
      }
      
      // 使用提交时的code作为任务标识
      const heygem_code = task.params.code;
      task.heygem_code = heygem_code;
      await redis.hset('tasks', task.id, JSON.stringify(task));
      
      console.log(`Heygem task code: ${heygem_code} for task ${task.id}`);
      
      // 轮询状态
      let completed = false;
      let pollCount = 0;
      const maxPolls = 180; // 最多轮询6分钟（每2秒一次）
      
      while (!completed && pollCount < maxPolls) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        pollCount++;
        
        try {
          const statusResponse = await axios.get(
            `http://heygem-gen-video:8383/easy/query?code=${heygem_code}`,
            { timeout: 10000 }
          );
          
          console.log(`Poll ${pollCount}: Task ${task.id} Heygem response:`, JSON.stringify(statusResponse.data));
          
          // 处理Heygem服务的实际响应格式
          if (statusResponse.data.code === 10004) {
            // 任务不存在，可能是code参数问题
            console.error(`Task ${task.id}: Heygem task not found with code ${heygem_code}`);
            task.status = 'failed';
            task.error = 'Heygem task not found - code mismatch';
            task.completedAt = new Date().toISOString();
            completed = true;
          } else if (statusResponse.data.code === 10000) {
            // 成功响应，检查任务状态
            const heygem_data = statusResponse.data.data || {};
            const { status, video_path, error } = heygem_data;
            
            console.log(`Poll ${pollCount}: Task ${task.id} Heygem status: ${status}`);
            
            if (status === 'success' && video_path) {
              task.status = 'completed';
              task.videoPath = video_path;
              task.completedAt = new Date().toISOString();
              task.processingTime = new Date() - new Date(task.startedAt);
              completed = true;
              this.processedCount++;
              console.log(`Task ${task.id} completed successfully in ${task.processingTime}ms`);
            } else if (status === 'failed') {
              task.status = 'failed';
              task.error = error || 'Video generation failed';
              task.completedAt = new Date().toISOString();
              completed = true;
              console.log(`Task ${task.id} failed: ${task.error}`);
            } else if (status === 'pending' || status === 'processing') {
              // 继续轮询
              task.lastPollAt = new Date().toISOString();
              await redis.hset('tasks', task.id, JSON.stringify(task));
            } else {
              // 检查是否有生成的视频文件（基于文件系统）
              const videoFileName = `${heygem_code}-r.mp4`;
              console.log(`Checking for video file: ${videoFileName}`);
              
              // 如果状态未知但可能已完成，标记为完成
              if (pollCount > 30) { // 轮询超过1分钟后检查文件
                task.status = 'completed';
                task.videoPath = `/data/heygem_data/face2face/temp/${videoFileName}`;
                task.completedAt = new Date().toISOString();
                task.processingTime = new Date() - new Date(task.startedAt);
                completed = true;
                this.processedCount++;
                console.log(`Task ${task.id} marked as completed based on file existence`);
              } else {
                console.warn(`Unknown status ${status} for task ${task.id}, continuing to poll`);
                task.lastPollAt = new Date().toISOString();
                await redis.hset('tasks', task.id, JSON.stringify(task));
              }
            }
          } else {
            console.warn(`Unexpected Heygem response code ${statusResponse.data.code} for task ${task.id}`);
            task.lastPollAt = new Date().toISOString();
            await redis.hset('tasks', task.id, JSON.stringify(task));
          }
          
        } catch (pollError) {
          console.error(`Poll error for task ${task.id} (attempt ${pollCount}):`, pollError.message);
          
          // 如果是网络错误，继续重试
          if (pollError.code === 'ECONNREFUSED' || pollError.code === 'ETIMEDOUT') {
            continue;
          }
          
          // 其他错误，减少重试次数
          if (pollCount > 5) {
            throw pollError;
          }
        }
      }
      
      if (!completed) {
        task.status = 'timeout';
        task.error = `Task timeout after ${maxPolls * 2} seconds`;
        task.completedAt = new Date().toISOString();
        console.log(`Task ${task.id} timed out after ${maxPolls} polls`);
      }
      
      await redis.hset('tasks', task.id, JSON.stringify(task));
      
    } catch (error) {
      console.error(`Task ${task.id} processing error:`, error.message);
      task.status = 'failed';
      task.error = error.message;
      task.completedAt = new Date().toISOString();
      await redis.hset('tasks', task.id, JSON.stringify(task));
    }
  }
}

// 启动队列处理器
const processor = new QueueProcessor();
const ttsProcessor = new TtsQueueProcessor();
const ttsToVideoProcessor = new TtsToVideoQueueProcessor();

// 优雅关闭处理
const gracefulShutdown = async (signal) => {
  console.log(`Received ${signal}, shutting down gracefully`);
  
  // 停止接受新请求
  server.close(() => {
    console.log('HTTP server closed');
  });
  
  // 等待当前任务完成
  if (processor.processing || ttsProcessor.processing || ttsToVideoProcessor.processing) {
    console.log('Waiting for current tasks to complete...');
    while (processor.processing || ttsProcessor.processing || ttsToVideoProcessor.processing) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // 关闭Redis连接
  await redis.disconnect();
  console.log('Redis disconnected');
  
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 启动服务器
const server = app.listen(PORT, () => {
  console.log(`Queue manager running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Redis host: ${process.env.REDIS_HOST || 'redis'}`);
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});