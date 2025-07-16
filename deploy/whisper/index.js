import Replicate from "replicate";
import dotenv from "dotenv";

// 加载 .env 变量
dotenv.config();

// 初始化 Replicate 客户端
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// 设置你的音频 URL（必须公网可访问）
const input = {
  audio: "https://636c-cloud1-4g70ln4ka8628fc2-1348641401.tcb.qcloud.la/generated_videos/audio_tts_to_video_1752663865764_9kq7mniia.mp3?sign=ed46e078187894cec1861ae394f88e65&t=1752668116", // ← 替换成你的音频地址
};

async function transcribeAudio() {
  try {
    const output = await replicate.run("openai/whisper:8099696689d249cf8b122d833c36ac3f75505c666a395ca40ef26f68e7d3d16e", {
      input,
    });

    // 打印返回结果
    console.log("=== 转录结果（含时间轴） ===");
    output.segments.forEach((segment, idx) => {
      console.log(`[${segment.start.toFixed(2)} - ${segment.end.toFixed(2)}] ${segment.text}`);
    });
  } catch (err) {
    console.error("出错了:", err.message);
  }
}

transcribeAudio();
