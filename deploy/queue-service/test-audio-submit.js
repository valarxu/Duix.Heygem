const axios = require('axios');
const fs = require('fs');
const path = require('path');

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0,
      v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 测试不同的音频参数格式
async function testAudioFormats() {
  console.log('测试 /easy/submit 接口的音频参数支持...');
  console.log('\n' + '='.repeat(60));

  const baseParams = {
    chaofen: 0,
    code: generateUUID(),
    pn: 1,
    video_url: "https://636c-cloud1-4g70ln4ka8628fc2-1348641401.tcb.qcloud.la/digital_human_videos/1751375338375_bp5hi631k.mp4",
    watermark_switch: 0
  };

  // 测试1: 不带音频参数（原始测试）
  console.log('\n1. 测试不带音频参数');
  await testSubmit({ ...baseParams, code: generateUUID() });

  // 测试2: 带audio_url参数（HTTP URL）
  console.log('\n2. 测试带audio_url参数（HTTP URL）');
  await testSubmit({
    ...baseParams,
    code: generateUUID(),
    audio_url: "https://example.com/test.wav"
  });

  // 测试3: 带audio_url参数（本地路径）
  console.log('\n3. 测试带audio_url参数（本地路径）');
  await testSubmit({
    ...baseParams,
    code: generateUUID(),
    audio_url: "/data/audio/test.wav"
  });

  // 测试4: 带audio_path参数
  console.log('\n4. 测试带audio_path参数');
  await testSubmit({
    ...baseParams,
    code: generateUUID(),
    audio_path: "/data/audio/test.wav"
  });

  // 测试5: 带audio_data参数（base64）
  console.log('\n5. 测试带audio_data参数（base64）');
  await testSubmit({
    ...baseParams,
    code: generateUUID(),
    audio_data: "UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA="
  });

  // 测试6: 带audio参数（对象格式）
  console.log('\n6. 测试带audio参数（对象格式）');
  await testSubmit({
    ...baseParams,
    code: generateUUID(),
    audio: {
      url: "https://example.com/test.wav",
      type: "wav"
    }
  });

  console.log('\n' + '='.repeat(60));
  console.log('测试完成！');
}

async function testSubmit(params) {
  try {
    console.log('请求参数:', JSON.stringify(params, null, 2));
    
    const response = await axios.post(
      'http://127.0.0.1:8383/easy/submit',
      params,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log('✅ 响应状态:', response.status);
    console.log('✅ 响应数据:', JSON.stringify(response.data, null, 2));
    
    // 如果成功，尝试查询状态
    if (response.status === 200 && response.data.success) {
      console.log('🔍 查询任务状态...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const queryResponse = await axios.get(
        `http://127.0.0.1:8383/easy/query?code=${params.code}`,
        { timeout: 5000 }
      );
      
      console.log('🔍 查询结果:', JSON.stringify(queryResponse.data, null, 2));
    }
    
  } catch (error) {
    console.error('❌ 请求失败:', error.message);
    
    if (error.response) {
      console.error('❌ 响应状态:', error.response.status);
      console.error('❌ 响应数据:', JSON.stringify(error.response.data, null, 2));
    }
  }
  
  console.log('-'.repeat(40));
}

// 运行测试
testAudioFormats().catch(console.error);