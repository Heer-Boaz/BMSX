// function playVGMInstrument(context: AudioContext, instrument: VGMInstrument) {
//     const oscillator = context.createOscillator();
//     const gainNode = context.createGain();
//     oscillator.connect(gainNode);
//     gainNode.connect(context.destination);

//     const dataLength = instrument.data.length;
//     for (let i = 0; i < dataLength; i += 4) {
//         const waveType = instrument.data[i];
//         const volume = instrument.data[i + 1];
//         const frequency = instrument.data[i + 2] + (instrument.data[i + 3] << 8);

//         oscillator.type = getWaveType(waveType);
//         gainNode.gain.value = volume / 255;
//         oscillator.frequency.value = frequency;

//         oscillator.start(i * context.sampleRate);
//         oscillator.stop((i + 4) * context.sampleRate);
//     }
// }

// function getWaveType(type: number): OscillatorType {
//     switch (type) {
//         case 0:
//             return 'sine';
//         case 1:
//             return 'square';
//         case 2:
//             return 'sawtooth';
//         case 3:
//             return 'triangle';
//         default:
//             return 'sine';
//     }
// }

// // Example usage
// const context = new AudioContext();
// const blainstrument: VGMInstrumentRecord = {
//     id: 0,
//     type: 0,
//     chip: 'AY-3-8910',
//     data: [0, 255, 440, 0, 0, 255, 880, 0] // Example A440/A880 tone with full volume
// };
// playVGMInstrument(context, blainstrument);