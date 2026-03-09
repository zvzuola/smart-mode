/**
 * AudioWorklet Processor for Real-time Audio Processing
 * 提取 PCM 数据 @16kHz
 */

class AudioStreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.buffer = [];
    this.bufferSize = 0;
    // 累积到一定大小后发送 (100ms @ 16kHz = 1600 samples)
    this.chunkSize = 1600; // 100ms
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    
    // 如果没有输入，返回 true 继续处理
    if (!input || !input[0]) {
      return true;
    }

    // 获取第一个声道的数据
    const channelData = input[0];
    
    // 将数据添加到缓冲区
    this.buffer.push(...channelData);
    this.bufferSize += channelData.length;

    // 当缓冲区达到一定大小时，发送数据
    if (this.bufferSize >= this.chunkSize) {
      const dataToSend = new Float32Array(this.buffer.slice(0, this.chunkSize));
      
      // 发送数据到主线程
      this.port.postMessage({
        type: 'audio-data',
        data: dataToSend,
        sampleRate: sampleRate, // 使用全局 sampleRate (由浏览器提供)
      });

      // 清理已发送的数据
      this.buffer = this.buffer.slice(this.chunkSize);
      this.bufferSize = this.buffer.length;
    }

    // 返回 true 表示继续处理
    return true;
  }
}

registerProcessor('audio-stream-processor', AudioStreamProcessor);

