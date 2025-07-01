const axios = require('axios');

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0,
      v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 测试TTS转视频功能
async function testTtsToVideo() {
  console.log('测试TTS转视频功能...');
  console.log('\n' + '='.repeat(60));

  const testData = {
    "ttsParams": {
      "speaker": "674b9ea6-f8ed-4b2c-a178-8194e1927667",
      "text": "担心小偷盯上你家老式防盗门？",
      "format": "mp3",
      "topP": 0.7,
      "max_new_tokens": 1024,
      "chunk_length": 100,
      "repetition_penalty": 1.2,
      "temperature": 0.7,
      "need_asr": false,
      "streaming": false,
      "is_fixed_seed": 0,
      "is_norm": 1,
      "reference_audio": "https://636c-cloud1-4g70ln4ka8628fc2-1348641401.tcb.qcloud.la/voice_clone/voice_clone_1751179509071.mp3",
      "reference_text": "夏天来喽，又能吃上西瓜啦，我真的太喜欢在空调房吃西瓜了，这种感觉真的超爽!"
    },
    "videoParams": {
      "video_url": "https://636c-cloud1-4g70ln4ka8628fc2-1348641401.tcb.qcloud.la/digital_human_videos/1751375338375_bp5hi631k.mp4",
      "chaofen": 0,
      "watermark_switch": 0,
      "pn": 1,
      "code": generateUUID()
    }
  };

  try {
    console.log('1. 提交TTS转视频任务');
    console.log('请求数据:', JSON.stringify(testData, null, 2));

    const submitResponse = await axios.post(
      'http://127.0.0.1:3000/api/tts-to-video/submit',
      testData,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    console.log('✅ 提交响应:', JSON.stringify(submitResponse.data, null, 2));

    if (submitResponse.data.success && submitResponse.data.taskId) {
      const taskId = submitResponse.data.taskId;
      console.log(`\n2. 监控任务状态 (任务ID: ${taskId})`);

      // 轮询任务状态
      let completed = false;
      let pollCount = 0;
      const maxPolls = 10; // 最多轮询10次（每30秒一次）

      while (!completed && pollCount < maxPolls) {
        await new Promise(resolve => setTimeout(resolve, 30000)); // 等待30秒
        pollCount++;

        try {
          const statusResponse = await axios.get(
            `http://127.0.0.1:3000/api/tts-to-video/status/${taskId}`,
            { timeout: 10000 }
          );

          console.log("statusResponse-data: ", statusResponse.data);

          const task = statusResponse.data;
          console.log(`\n[轮询 ${pollCount}] 任务状态:`, {
            status: task.status,
            stage: task.stage,
            ttsCompleted: !!task.ttsCompletedAt,
            audioFilePath: task.ttsResult?.audioFilePath,
            videoPath: task.videoPath,
            error: task.error
          });

          if (task.status === 'completed') {
            console.log('\n🎉 任务完成!');
            console.log('TTS音频文件:', task.ttsResult?.audioFilePath);
            console.log('生成的视频:', task.videoPath);
            console.log('音频下载链接:', task.audioUrl);
            completed = true;
          } else if (task.status === 'failed') {
            console.log('\n❌ 任务失败:', task.error);
            completed = true;
          } else if (task.status === 'processing') {
            if (task.stage === 'tts') {
              console.log('   -> TTS阶段处理中...');
            } else if (task.stage === 'video') {
              console.log('   -> 视频生成阶段处理中...');
              if (task.ttsResult?.audioFilePath) {
                console.log('   -> 音频文件已生成:', task.ttsResult.audioFilePath);
              }
            }
          }

        } catch (statusError) {
          console.error(`轮询 ${pollCount} 失败:`, statusError.message);
        }
      }

      if (!completed) {
        console.log('\n⏰ 轮询超时，任务可能仍在处理中');
      }

    } else {
      console.error('❌ 任务提交失败');
    }

  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);

    if (error.response) {
      console.error('响应状态:', error.response.status);
      console.error('响应数据:', JSON.stringify(error.response.data, null, 2));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('测试完成！');
}

// 运行测试
testTtsToVideo().catch(console.error);