const axios = require('axios');

// 测试whisper转录服务
async function testWhisperService() {
  try {
    console.log('Testing Whisper transcription service...');
    
    // 测试音频URL（需要是公网可访问的音频文件）
    const testAudioUrl = 'https://636c-cloud1-4g70ln4ka8628fc2-1348641401.tcb.qcloud.la/generated_videos/audio_tts_to_video_1752663865764_9kq7mniia.mp3?sign=ed46e078187894cec1861ae394f88e65&t=1752668116';
    
    const response = await axios.post(
      'http://localhost:3001/transcribe',
      { audio_url: testAudioUrl },
      {
        timeout: 180000,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Whisper service response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.success) {
      console.log('\n=== Transcription Result ===');
      console.log('Full text:', response.data.data.text);
      console.log('Language:', response.data.data.language);
      console.log('\n=== Segments ===');
      response.data.data.segments.forEach((segment, idx) => {
        console.log(`[${segment.start} - ${segment.end}] ${segment.text}`);
      });
    }
    
  } catch (error) {
    console.error('Test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// 测试健康检查
async function testHealthCheck() {
  try {
    console.log('Testing health check...');
    const response = await axios.get('http://localhost:3001/health');
    console.log('Health check response:', response.data);
  } catch (error) {
    console.error('Health check failed:', error.message);
  }
}

// 运行测试
async function runTests() {
  await testHealthCheck();
  console.log('\n' + '='.repeat(50) + '\n');
  await testWhisperService();
}

runTests();