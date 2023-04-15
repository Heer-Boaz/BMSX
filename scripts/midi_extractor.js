// const fs = require('fs');
// const args = process.argv.slice(2);

// if (args.length !== 1) {
//     console.error('Usage: node extract-midi-notes.js <filename>');
//     process.exit(1);
// }

// const fileName = args[0];
// const fileBuffer = fs.readFileSync(fileName);

// // Definieer een hulpfunctie om een reeks bytes in een getal te converteren
// function bytesToNumber(bytes) {
//     let result = 0;
//     for (let i = 0; i < bytes.length; i++) {
//         result += bytes[i] << (8 * (bytes.length - 1 - i));
//     }
//     return result;
// }

// function readVariableLengthQuantity(buffer, startOffset) {
//     let result = 0;
//     let offset = startOffset;
//     let byte;
//     do {
//         byte = buffer.readUInt8(offset);
//         offset++;
//         result = (result << 7) | (byte & 0x7F);
//     } while (byte & 0x80);
//     return { value: result, bytesRead: offset - startOffset };
// }

// // Blijf door alle chunks in het MIDI-bestand lussen totdat het einde van het bestand is bereikt
// let offset = 0;
// let timeDivision = null;
// let notes = [];

// while (offset < fileBuffer.length) {
//     // Lees het volgende chunk
//     const chunkHeader = fileBuffer.slice(offset, offset + 8);
//     const chunkHeaderType = chunkHeader.slice(0, 4).toString();
//     const chunkHeaderLength = bytesToNumber(Array.from(chunkHeader.slice(4, 8)));

//     offset += 8;

//     // Verwerk de chunk op basis van het type
//     if (chunkHeaderType === 'MThd') {
//         // Verwerk het header chunk
//         const formatType = bytesToNumber(Array.from(fileBuffer.slice(offset, offset + 2)));
//         const numTracks = bytesToNumber(Array.from(fileBuffer.slice(offset + 2, offset + 4)));
//         timeDivision = bytesToNumber(Array.from(fileBuffer.slice(offset + 4, offset + 6)));
//         console.log(`Format type: ${formatType}`);
//         console.log(`Number of tracks: ${numTracks}`);
//         console.log(`Time division: ${timeDivision}`);

//         offset += chunkHeaderLength;
//     } else if (chunkHeaderType === 'MTrk') {
//         // Verwerk een track chunk
//         // const chunkEndOffset = offset + chunkHeaderLength;
//         // Houd de huidige tijd en toonhoogte bij

//         let currentTime = 0;
//         let currentPitch = null;
//         let currentVelocity = null;

//         // Houd de startpositie van de huidige track chunk bij
//         const trackChunkStart = offset;

//         while (offset < fileBuffer.length && offset < trackChunkStart + chunkHeaderLength) {
//             const { value: deltaTime, bytesRead: deltaTimeBytesRead } = readVariableLengthQuantity(fileBuffer, offset);
//             currentTime += deltaTime / timeDivision;
//             offset += deltaTimeBytesRead;

//             const currentEventTypeByte = fileBuffer.readUInt8(offset);
//             if (currentEventTypeByte >= 128) {
//                 eventTypeByte = currentEventTypeByte;
//                 offset++;
//             }

//             const channel = eventTypeByte & 0x0F;

//             if (eventTypeByte === 0xff) {
//                 // Meta-evenement
//                 const metaEventTypeByte = fileBuffer.readUInt8(offset);
//                 offset++;
//                 const { value: metaEventLength, bytesRead: metaEventLengthBytesRead } = readVariableLengthQuantity(fileBuffer, offset);
//                 offset += metaEventLengthBytesRead + metaEventLength;
//             } else if ((eventTypeByte >> 4) === 0x8 || (eventTypeByte >> 4) === 0x9 && fileBuffer[offset + 1] === 0) {
//                 // Note off or note on with velocity 0
//                 const noteOffPitch = fileBuffer.readUInt8(offset);
//                 offset++;
//                 const noteOffVelocity = fileBuffer.readUInt8(offset);
//                 offset++;

//                 // Find the note in the list and set its duration
//                 for (const note of notes) {
//                     if (note.pitch === noteOffPitch && note.channel === channel && note.duration === null) {
//                         note.duration = currentTime - note.startTime;
//                         break;
//                     }
//                 }
//             } else if ((eventTypeByte >> 4) === 0x9) {
//                 // Note on
//                 const noteOnPitch = fileBuffer.readUInt8(offset);
//                 offset++;
//                 const noteOnVelocity = fileBuffer.readUInt8(offset);
//                 offset++;

//                 // Add the note to the list of notes
//                 notes.push({
//                     pitch: noteOnPitch,
//                     velocity: noteOnVelocity,
//                     startTime: currentTime,
//                     duration: null,
//                     channel
//                 });
//             } else {
//                 // Onbekend evenementstype, sla de rest van de gegevens voor dit evenement over
//                 const eventDataLengthBytes = [];
//                 while (true) {
//                     const byte = fileBuffer.readUInt8(offset);
//                     offset++;
//                     eventDataLengthBytes.push(byte);
//                     if (byte < 128) {
//                         break;
//                     }
//                 }
//                 const eventDataLength = bytesToNumber(eventDataLengthBytes);
//                 offset += eventDataLength;
//             }
//         }
//     } else {
//         // Onbekend chunktype, sla de inhoud van de chunk over
//         offset += chunkHeaderLength;
//     }
// }

// console.log(notes);

const fs = require('fs');
const { parseMidi } = require('midi-file');
const args = process.argv.slice(2);

if (args.length !== 1) {
    console.error('Usage: node extract-midi-notes.js <filename>');
    process.exit(1);
}

const fileName = args[0];
const fileBuffer = fs.readFileSync(fileName);

// Parse the MIDI file
const midiData = parseMidi(fileBuffer);

// Extract notes from the MIDI file
const notes = [];
for (const track of midiData.tracks) {
    let currentTime = 0;

    for (const event of track) {
        currentTime += event.deltaTime;

        if (event.type === 'noteOn') {
            notes.push({
                pitch: event.noteNumber,
                velocity: event.velocity,
                startTime: currentTime,
                duration: null,
                channel: event.channel
            });
        } else if (event.type === 'noteOff') {
            for (const note of notes) {
                if (note.pitch === event.noteNumber && note.channel === event.channel && note.duration === null) {
                    note.duration = currentTime - note.startTime;
                    break;
                }
            }
        }
    }
}

// Group notes by channel
const notesByChannel = {};
for (const note of notes) {
    if (note.duration !== null) {
        if (!notesByChannel[note.channel]) {
            notesByChannel[note.channel] = [];
        }
        notesByChannel[note.channel].push(note);
    }
}

// Convert notes to LSystem symbols
const pitchToSymbol = {};
const symbolToPitch = {};
const basePitchCharCode = 'A'.charCodeAt(0);

for (const channel in notesByChannel) {
    for (const note of notesByChannel[channel]) {
        if (!pitchToSymbol[note.pitch]) {
            const symbol = String.fromCharCode(basePitchCharCode + Object.keys(pitchToSymbol).length);
            pitchToSymbol[note.pitch] = symbol;
            symbolToPitch[symbol] = note.pitch;
        }
    }
}

// Create a mapping for durations
const durationToSymbol = {};
const symbolToDuration = {};
const baseDurationCharCode = 'a'.charCodeAt(0);

const getDurationSymbol = (duration) => {
    if (!durationToSymbol[duration]) {
        const symbol = String.fromCharCode(baseDurationCharCode + Object.keys(durationToSymbol).length);
        durationToSymbol[duration] = symbol;
        symbolToDuration[symbol] = duration;
    }

    return durationToSymbol[duration];
};

// Convert notes to strings per channel
const channelStrings = {};
for (const channel in notesByChannel) {
    const noteStrings = notesByChannel[channel].map(note => {
        return pitchToSymbol[note.pitch] + getDurationSymbol(Math.round(note.duration));
    });

    channelStrings[channel] = noteStrings.join('');
}

console.log(channelStrings);

// Optional: Print the mappings for reference
console.log('Pitch to Symbol mapping:', pitchToSymbol);
console.log('Symbol to Pitch mapping:', symbolToPitch);
console.log('Duration to Symbol mapping:', durationToSymbol);
console.log('Symbol to Duration mapping:', symbolToDuration);

// Kan je de code geven voor "maakLsystemRegels" die er nu zo uit ziet?
//     maakLSystemRegels(inputString, midiOutput) {
//         // Maak L-systeemregels op basis van de geëxtraheerde noten uit het MIDI-bestand
//         const lSystemRegels = {};
//         for (let i = 0; i < inputString.length; i += 2) {
//             const symbool = inputString[i];
//             const volgendSymbool = inputString[i + 2] || '';
//             lSystemRegels[symbool] = lSystemRegels[symbool] ? lSystemRegels[symbool] + volgendSymbool : volgendSymbool;
//         }
//         return lSystemRegels;
//     }

// De code moet je updaten om de LSysteemregels te produceren op basis van MIDI-output dat is geextraheerd. De code die dat doet zie je hieronder:
