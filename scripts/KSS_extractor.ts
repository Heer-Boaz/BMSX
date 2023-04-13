import { readFile } from 'fs/promises';


// function extractInstrumentsFromKSS(kssData: Uint8Array, encoding: string = 'utf-8'): KSSInstrument[] {
//   const decoder = new TextDecoder(encoding);
//   const instruments: KSSInstrument[] = [];
//   let offset = 0x80;
//   while (offset < kssData.length) {
//     const instrument: KSSInstrument = {
//       id: kssData[offset],
//       name: decoder.decode(kssData.subarray(offset + 1, offset + 33)).trim(),
//       type: kssData[offset + 33],
//       data: Array.from(kssData.subarray(offset + 34, offset + 42))
//     };
//     instruments.push(instrument);
//     offset += 42;
//     return instruments;
//   }
//   return instruments;
// }

// interface MSXKSSInstrument {
//     name: string;
//     waveform: number[];
//     envelope: number[];
//     lfo: number[];
//     volume: number;
// }

// function extractInstrumentsFromKSS(kssData: Uint8Array): MSXKSSInstrument[] {
//     const instruments: MSXKSSInstrument[] = [];
//     let offset = 0x8000;
//     while (offset < kssData.length) {
//         const instrument: MSXKSSInstrument = {
//             name: '',
//             waveform: [],
//             envelope: [],
//             lfo: [],
//             volume: 0
//         };

//         // Read the instrument name
//         for (let i = 0; i < 10; i++) {
//             const charCode = kssData[offset + i];
//             if (charCode === 0) break;
//             instrument.name += String.fromCharCode(charCode);
//         }

//         // Read the instrument waveform
//         for (let i = 0; i < 16; i++) {
//             instrument.waveform.push(kssData[offset + 10 + i]);
//         }

//         // Read the instrument envelope
//         for (let i = 0; i < 16; i++) {
//             instrument.envelope.push(kssData[offset + 26 + i]);
//         }

//         // Read the instrument LFO
//         for (let i = 0; i < 16; i++) {
//             instrument.lfo.push(kssData[offset + 42 + i]);
//         }

//         // Read the instrument volume
//         instrument.volume = kssData[offset + 58];

//         instruments.push(instrument);
//         offset += 59;
//     }
//     return instruments;
// }

// interface KSSInstrument {
//     id: number;
//     name: string;
//     waveform: number[];
//     envelope: number[];
//     volume: number;
// }

// function extractInstrumentsFromKSS(kssData: Uint8Array): KSSInstrument[] {
//     const instruments: KSSInstrument[] = [];
//     let offset = 0x80;
//     while (offset < kssData.length) {
//         const instrument: KSSInstrument = {
//             id: kssData[offset],
//             name: '',
//             waveform: [],
//             envelope: [],
//             volume: 0
//         };

//         // Read the instrument name
//         for (let i = 0; i < 16; i++) {
//             const charCode = kssData[offset + i + 1];
//             if (charCode === 0) break;
//             instrument.name += String.fromCharCode(charCode);
//         }

//         // Read the waveform data
//         for (let i = 0; i < 16; i++) {
//             instrument.waveform.push(kssData[offset + 17 + i]);
//         }

//         // Read the envelope data
//         for (let i = 0; i < 16; i++) {
//             instrument.envelope.push(kssData[offset + 33 + i]);
//         }

//         // Read the volume data
//         instrument.volume = kssData[offset + 49];

//         instruments.push(instrument);
//         offset += 50;
//     }
//     return instruments;
// }
interface KSSInstrument {
    id: number;
    name: string;
    type: number;
    data: number[];
}

function extractInstrumentsFromKSS(kssData: Uint8Array): KSSInstrument[] {
  const instruments: KSSInstrument[] = [];
  let offset = 0x80;
  while (offset < kssData.length) {
    const instrument: KSSInstrument = {
      id: kssData[offset],
      name: '',
      type: kssData[offset + 33],
      data: Array.from(kssData.subarray(offset + 34, offset + 42)),
    };

    // Read the instrument name
    for (let i = 0; i < 32; i++) {
      const charCode = kssData[offset + i + 1];
      if (charCode === 0) break;
      instrument.name += String.fromCharCode(charCode);
    }

    // Check for duplicate instruments with the same ID
    const existingInstrument = instruments.find(
      (inst) => inst.id === instrument.id
    );
    if (existingInstrument) {
      // If the names of the two instruments are the same, assume they are the same instrument
      if (existingInstrument.name === instrument.name) {
        existingInstrument.type = instrument.type;
        existingInstrument.data = instrument.data;
      } else {
        // Otherwise, add the instrument with a modified ID to avoid collisions
        instruments.push({
          id: instrument.id + 0x100,
          name: instrument.name,
          type: instrument.type,
          data: instrument.data,
        });
      }
    } else {
      instruments.push(instrument);
    }

    offset += 42;
  }
  return instruments;
}


async function openKSSFile(filePath: string): Promise<KSSInstrument[]> {
    const kssData = await readFile(filePath);
    return extractInstrumentsFromKSS(new Uint8Array(kssData.buffer));
}

// Usage example
(async () => {
    const instruments = await openKSSFile('C:\\Users\\boazp\\Music\\DeusExMusic\\MSX\\sd-snatcher\\sdsnatch.kss');
    console.log(instruments);
})();
