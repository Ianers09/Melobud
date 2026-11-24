/* global AudioWorkletProcessor, registerProcessor */
// AudioWorklet that forwards raw microphone PCM (mono) to the main thread in
// blocks of 1024 samples.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(1024)
    this.length = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (input && input.length) {
      const channels = input.length
      const frames = input[0].length
      for (let i = 0; i < frames; i++) {
        let sum = 0
        for (let c = 0; c < channels; c++) sum += input[c][i]
        this.buffer[this.length++] = sum / channels
        if (this.length === this.buffer.length) {
          this.port.postMessage(this.buffer.slice(0))
          this.length = 0
        }
      }
    }
    return true
  }
}

registerProcessor('capture-processor', CaptureProcessor)
