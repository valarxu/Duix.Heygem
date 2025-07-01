const axios = require('axios');

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0,
      v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 测试 heygem-gen-video 接口
async function testHeygemVideoAPI() {
  let taskId = generateUUID();
  const testData = {
    chaofen: 0,
    code: taskId,
    pn: 1,
    video_url: "https://636c-cloud1-4g70ln4ka8628fc2-1348641401.tcb.qcloud.la/digital_human_videos/1751375338375_bp5hi631k.mp4",
    watermark_switch: 0,
    audio_url: "https://636c-cloud1-4g70ln4ka8628fc2-1348641401.tcb.qcloud.la/digital_human_audios/task_1751207360422_iphioqj7o_1751207368412.wav?sign=42c555224bf8c6e4ef47cf942f9c3e5d&t=1751379025"
  };

  console.log('开始测试 heygem-gen-video 接口...');
  console.log('请求数据:', JSON.stringify(testData, null, 2));
  console.log('\n' + '='.repeat(50));

  try {
    // 测试 submit 接口
    console.log('\n1. 测试 /easy/submit 接口');
    const submitResponse = await axios.post(
      'http://127.0.0.1:8383/easy/submit',
      testData,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30秒超时
      }
    );

    console.log('Submit 响应状态:', submitResponse.status);
    console.log('Submit 响应头:', JSON.stringify(submitResponse.headers, null, 2));
    console.log('Submit 响应数据:', JSON.stringify(submitResponse.data, null, 2));

    // 如果提交成功，测试查询接口
    if (submitResponse.status === 200) {
      console.log('\n' + '='.repeat(50));
      console.log('\n2. 测试 /easy/query 接口');
      
      // 等待一段时间再查询
      console.log('等待 3 秒后查询状态...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      const queryResponse = await axios.get(
        `http://127.0.0.1:8383/easy/query?code=${testData.code}`,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 10000 // 10秒超时
        }
      );

      console.log('Query 响应状态:', queryResponse.status);
      console.log('Query 响应头:', JSON.stringify(queryResponse.headers, null, 2));
      console.log('Query 响应数据:', JSON.stringify(queryResponse.data, null, 2));

      // 如果需要，可以继续轮询查询状态
      if (queryResponse.data && queryResponse.data.code === 10000) {
        const data = queryResponse.data.data || {};
        if (data.status === 'processing') {
          console.log('\n任务正在处理中，可以继续轮询查询状态...');
          console.log('提示: 可以定期调用查询接口检查任务进度');
        } else if (data.status === 'success') {
          console.log('\n任务已完成！');
          if (data.video_path) {
            console.log('视频路径:', data.video_path);
          }
        } else if (data.status === 'failed') {
          console.log('\n任务失败:', data.error || '未知错误');
        }
      }
    }

  } catch (error) {
    console.error('\n❌ 请求失败:', error);
    
    if (error.response) {
      // 服务器响应了错误状态码
      console.error('响应状态:', error.response.status);
      console.error('响应头:', JSON.stringify(error.response.headers, null, 2));
      console.error('响应数据:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      // 请求已发出但没有收到响应
      console.error('网络错误 - 无响应');
      console.error('请求配置:', error.config);
    } else {
      // 其他错误
      console.error('错误信息:', error.message);
    }
    
    console.error('\n可能的原因:');
    console.error('1. heygem-gen-video 服务未启动');
    console.error('2. 网络连接问题');
    console.error('3. 服务端口不正确');
    console.error('4. 请求参数格式错误');
  }

  console.log('\n' + '='.repeat(50));
  console.log('测试完成');
}

// 执行测试
if (require.main === module) {
  testHeygemVideoAPI().catch(console.error);
}

module.exports = { testHeygemVideoAPI };