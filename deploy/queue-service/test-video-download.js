const axios = require('axios');

// 测试视频下载API功能
async function testVideoDownloadAPI() {
  console.log('测试视频下载API功能...');
  console.log('\n' + '='.repeat(60));

  // 测试数据 - 使用一个简单的视频生成任务
  const testData = {
    "video_url": "https://636c-cloud1-4g70ln4ka8628fc2-1348641401.tcb.qcloud.la/digital_human_videos/1751375338375_bp5hi631k.mp4",
    "audio_url": "https://636c-cloud1-4g70ln4ka8628fc2-1348641401.tcb.qcloud.la/voice_clone/voice_clone_1751179509071.mp3",
    "chaofen": 0,
    "watermark_switch": 0,
    "pn": 1
  };

  try {
    console.log('1. 提交视频生成任务');
    console.log('请求数据:', JSON.stringify(testData, null, 2));

    const submitResponse = await axios.post(
      'http://127.0.0.1:3000/api/video/submit',
      testData,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    console.log('\n提交响应:', JSON.stringify(submitResponse.data, null, 2));
    
    if (!submitResponse.data.success) {
      console.error('❌ 任务提交失败');
      return;
    }

    const taskId = submitResponse.data.taskId;
    console.log(`\n✅ 任务提交成功，TaskID: ${taskId}`);

    // 轮询任务状态
    console.log('\n2. 开始轮询任务状态...');
    let pollCount = 0;
    const maxPolls = 60; // 最多轮询60次（5分钟）
    
    while (pollCount < maxPolls) {
      pollCount++;
      
      try {
        const statusResponse = await axios.get(
          `http://127.0.0.1:3000/api/video/status/${taskId}`,
          { timeout: 10000 }
        );
        
        const status = statusResponse.data;
        console.log(`\n[轮询 ${pollCount}] 任务状态:`, {
          status: status.status,
          stage: status.stage,
          videoPath: status.videoPath,
          videoUrl: status.videoUrl,
          error: status.error
        });
        
        if (status.status === 'completed') {
          console.log('\n🎉 任务完成！');
          
          if (status.videoUrl) {
            console.log(`\n3. 测试视频下载API: ${status.videoUrl}`);
            
            // 测试视频下载（只获取头信息）
            try {
              const downloadResponse = await axios.head(
                `http://127.0.0.1:3000${status.videoUrl}`,
                { timeout: 10000 }
              );
              
              console.log('\n✅ 视频下载API测试成功！');
              console.log('响应头信息:');
              console.log('- Content-Type:', downloadResponse.headers['content-type']);
              console.log('- Content-Length:', downloadResponse.headers['content-length']);
              console.log('- Content-Disposition:', downloadResponse.headers['content-disposition']);
              
            } catch (downloadError) {
              console.error('❌ 视频下载API测试失败:', downloadError.message);
            }
          } else {
            console.log('⚠️ 任务完成但没有视频下载链接');
          }
          
          break;
        } else if (status.status === 'failed') {
          console.error(`❌ 任务失败: ${status.error}`);
          break;
        } else {
          // 继续轮询
          await new Promise(resolve => setTimeout(resolve, 5000)); // 等待5秒
        }
        
      } catch (statusError) {
        console.error(`❌ 查询状态失败 (轮询 ${pollCount}):`, statusError.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    if (pollCount >= maxPolls) {
      console.log('\n⏰ 轮询超时，任务可能仍在处理中');
    }
    
  } catch (error) {
    console.error('❌ 测试过程中发生错误:', error.message);
    if (error.response) {
      console.error('错误响应:', error.response.data);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('测试完成！');
}

// 运行测试
testVideoDownloadAPI().catch(console.error);