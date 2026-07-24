class NaturalVoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(1_024);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel?.length) {
      let sourceOffset = 0;
      while (sourceOffset < channel.length) {
        const sampleCount = Math.min(
          channel.length - sourceOffset,
          this.buffer.length - this.offset,
        );
        this.buffer.set(channel.subarray(sourceOffset, sourceOffset + sampleCount), this.offset);
        this.offset += sampleCount;
        sourceOffset += sampleCount;
        if (this.offset === this.buffer.length) {
          const samples = this.buffer;
          this.port.postMessage({ samples }, [samples.buffer]);
          this.buffer = new Float32Array(1_024);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("belldandy-natural-voice-capture", NaturalVoiceCaptureProcessor);
