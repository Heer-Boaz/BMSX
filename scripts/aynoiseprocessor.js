// AYNoiseProcessor.js
class AYNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 17-bit shift register, nonzero initial value.
    this.shiftRegister = 0x1FFFF;
    // Default: update every 800 samples.
    this.noisePeriod = 800;
    this.sampleCounter = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (data.param === 'setNoisePeriod') {
        this.noisePeriod = data.value;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const channelData = output[0]; // single channel output
    for (let i = 0; i < channelData.length; i++) {
      this.sampleCounter++;
      if (this.sampleCounter >= this.noisePeriod) {
        this.sampleCounter -= this.noisePeriod;
        // AY LFSR shift: newBit = bit0 XOR bit3.
        const bit0 = this.shiftRegister & 1;
        const bit3 = (this.shiftRegister >> 3) & 1;
        const newBit = bit0 ^ bit3;
        this.shiftRegister = (this.shiftRegister >> 1) | (newBit << 16);
      }
      // Output: use LSB, scaled to roughly [-0.3, 0.3]
      const noiseValue = ((this.shiftRegister & 1) * 2 - 1) * 0.3;
      channelData[i] = noiseValue;
    }
    return true;
  }
}

registerProcessor('ay-noise-processor', AYNoiseProcessor);
