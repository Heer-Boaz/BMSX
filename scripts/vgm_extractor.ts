// import { readFile } from 'fs/promises';
import { statSync, readFileSync } from 'fs';
import { terminal } from 'terminal-kit';

interface VGMInstrument {
    id: number;
    type: number;
    chip: string;
    data: number[];
}

function extractInstrumentsFromVGM(filePath: string): VGMInstrument[] {
    const kssData = readFileSync(filePath);
    const vgmData: Uint8Array = new Uint8Array(kssData.buffer);
    // const fileSize = statSync('path/to/vgm/file.vgm').size;
    // Get the total length of the file

    const unknownCommands: number[] = [];
    const instruments: VGMInstrument[] = [];
    let offset = 256; // Start after the 256 byte header
    const totalLength = vgmData.length - offset;
    // Set up the progress bar
    const progressBar = terminal.progressBar({
        title: 'Extracting instruments:',
        width: 80,
        eta: true,
        percent: true,
        items: totalLength,
        itemSize: 1,
        // inline: true,
        // syncMode: true,
    });

    terminal.clear();
    while (offset < vgmData.length) {
        const command = vgmData[offset];

        switch (command) {
            // AY-3-8910 write
            case 0xA0:
                const ayRegister = vgmData[offset + 1];
                const ayValue = vgmData[offset + 2];

                // Extract AY-3-8910 instrument data
                if (ayRegister >= 0x00 && ayRegister <= 0x0D) {
                    // Instrument ID
                    const instrumentId = ayRegister;

                    // Check for duplicate instruments
                    let instrument = instruments.find(
                        (inst) => inst.id === instrumentId && inst.chip === 'AY-3-8910'
                    );
                    if (!instrument) {
                        instrument = {
                            id: instrumentId,
                            type: 0,
                            chip: 'AY-3-8910',
                            data: [],
                        };
                        instruments.push(instrument);
                    }
                    instrument.data.push(ayValue);
                }

                offset += 3;
                break;

            // SCC-I (SCC+) write
            case 0xD2:
                const sccPort = vgmData[offset + 1];
                const sccRegister = vgmData[offset + 2];
                const sccValue = vgmData[offset + 3];
                if (sccPort === 0 && sccRegister >= 0x80 && sccRegister <= 0x9F) {
                    // Instrument ID
                    const instrumentId = sccRegister - 0x80;
                    // Check for duplicate instruments
                    let instrument = instruments.find(
                        (inst) => inst.id === instrumentId && inst.chip === 'SCC-I'
                    );
                    if (!instrument) {
                        instrument = { id: instrumentId, type: 0, chip: 'SCC-I', data: [] };
                        instruments.push(instrument);
                    }
                    instrument.data.push(sccValue);
                }
                offset += 4;
                break;

            // One-byte commands
            case 0x66: // end of sound data
                offset += 1;
                break;

            // Two-byte commands
            case 0x4F: // Game Gear PSG stereo
            case 0x50: // PSG (SN76489/SN76496)
                offset += 2;
                break;

            // Three-byte commands
            case 0x51: // YM2413
            case 0x52: // YM2612 port 0
            case 0x53: // YM2612 port 1
            case 0x54: // YM2151
            case 0x55: // YM2203
            case 0x56: // YM2608 port 0
            case 0x57: // YM2608 port 1
            case 0x58: // YM2610 port 0
            case 0x59: // YM2610 port 1
            case 0x5A: // YM3812
            case 0x5B: // YM3526
            case 0x5C: // Y8950
            case 0x5D: // YMZ280B
            case 0x5E: // YMF262 port 0
            case 0x5F: // YMF262 port 1
            case 0x61: // Wait n samples
                offset += 3;
                break;

            // Four-byte commands
            case 0x62: // Wait 735 samples (60th of a second)
            case 0x63: // Wait 882 samples (50th of a second)
            // Data command
            case 0x67:
                const dataType = vgmData[offset + 2];
                let dataSize = 0;
                let shift = 0;
                let index = offset + 3;
                let byte = vgmData[index];
                while (byte & 0x80) {
                    dataSize |= (byte & 0x7f) << shift;
                    shift += 7;
                    byte = vgmData[++index];
                }
                dataSize |= byte << shift;
                // Handle the data block if needed
                offset = index + dataSize + 1;
                break;
            case 0x68:// PCM RAM write
            case 0x90: // DAC Stream Control Write
            case 0x91:
            case 0x92:
            case 0x93:
            case 0x94:
            case 0x95:
            case 0xB0: // RF5C68
            case 0xB1: // RF5C164
            case 0xB2: // PWM
            case 0xB3: // GameBoy DMG
            case 0xB4: // NES APU
            case 0xB5: // MultiPCM
            case 0xB6: // uPD7759
            case 0xB7: // OKIM6258
            case 0xB8: // OKIM6295
            case 0xB9: // HuC6280
            case 0xBA: // K053260
            case 0xBB: // Pokey
            case 0xBC: // WonderSwan
            case 0xBD: // SAA1099
            case 0xBE: // ES5506
            case 0xBF: // GA20
            case 0xC0: // Sega PCM
            case 0xC1: // RF5C68
            case 0xC2: // RF5C164
            case 0xC3: // MultiPCM
            case 0xC4: // QSound
            case 0xC5: // SCSP
            case 0xC6: // WonderSwan
            case 0xC7: // VSU
            case 0xC8: // X1-010
            case 0xD0: // YMF278B
            case 0xD1: // YMF271
            case 0xD3: // K054539
            case 0xD4: // C140
            case 0xD5: // ES5503
            case 0xE1: // C352
                offset += 4;
                break;
            // Five-byte commands
            case 0xD6: // ES5506
                offset += 5;
                break;

            // Eight-byte commands
            case 0xE0: // Seek to offset
                offset += 8;
                break;
            case 0x70: // PWM clock
            case 0x74: // AY8910 clock
            case 0x78: // AY8910 Chip Type
            case 0x79: // AY8910 Flags
            case 0x7A: // YM2203/AY8910 Flags
            case 0x7B: // YM2608/AY8910 Flags
                // Handle these commands if needed
                offset += 5;
                break;
            case 0x7C: // Volume Modifier
            case 0x7D: // reserved
            case 0x7E: // Loop Base
            case 0x7F: // Loop Modifier
                // Handle these commands if needed
                offset += 2;
                break;
            // Default case for unhandled commands
            default:
                if (command >= 0x30 && command <= 0x3F) {
                    offset += 2; // one-byte commands
                } else if (command >= 0x40 && command <= 0x4E) {
                    offset += 3; // two-byte commands
                } else if (command >= 0xA1 && command <= 0xAF) {
                    offset += 3; // two-byte commands
                } else if (command >= 0xC9 && command <= 0xCF) {
                    offset += 4; // three-byte commands
                } else if (command >= 0xD7 && command <= 0xDF) {
                    offset += 4; // three-byte commands
                } else if (command >= 0xE2 && command <= 0xFF) {
                    offset += 5; // four-byte commands
                } else {
                    if (!unknownCommands.includes(command)) {
                        unknownCommands.push((command));
                    }
                    offset += 1;
                }
                break;
        }
        const progress = offset / vgmData.length;
        progressBar.update(progress);
    }
    progressBar.stop();
    // unknownCommands.forEach(command => console.error(`Unknown command 0x${command.toString(16)} at offset ${offset}`));

    return instruments;
}

// Usage example
(async () => {
    const instruments = extractInstrumentsFromVGM('C:\\Users\\boazp\\Music\\DeusExMusic\\MSX\\sd-snatcher\\04 Modern Crusade.vgm');
    console.log(instruments);
})();
