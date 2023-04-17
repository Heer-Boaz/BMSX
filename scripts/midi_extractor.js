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
let tempo = 120;
for (const track of midiData.tracks) {
    let currentTime = 0;

    for (const event of track) {
        currentTime += event.deltaTime;
        if (event.type === 'setTempo') {
            tempo = 60000000 / event.microsecondsPerBeat;
            break;
        }
        if (event.type === 'noteOn' && event.noteNumber !== undefined) {
            notes.push({
                pitch: event.noteNumber,
                velocity: event.velocity,
                startTime: currentTime,
                duration: null,
                channel: event.channel
            });
        } else if (event.type === 'noteOff' && event.noteNumber !== undefined) {
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

function gcd(a, b) {
    return b === 0 ? a : gcd(b, a % b);
}

function findBaseNoteLength(durations) {
    let baseNoteLength = durations[0];
    for (let i = 1; i < durations.length; i++) {
        baseNoteLength = gcd(baseNoteLength, durations[i]);
    }
    return baseNoteLength;
}
function midiDurationToAbcDuration(duration, baseNoteLength) {
    const wholeNoteLength = baseNoteLength * 4;
    const noteLength = Math.round(wholeNoteLength / duration);
    if (noteLength === 1) {
        return '';
    }
    let numerator = Math.round(wholeNoteLength * 4 / duration);
    let denominator = 4;
    if (!isFinite(numerator)) {
        numerator = 1;
        denominator = Math.round(duration / (baseNoteLength * 4));
    }
    return `${numerator}/${denominator}`;
}

function midiNoteToAbcPitch(midiNote) {
    const noteNames = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const octaveShift = Math.floor((midiNote - 12) / 12);
    const noteIndex = (midiNote - 12) % 12;
    const noteName = noteNames[Math.floor(noteIndex / 2)];
    const octave = "'".repeat(octaveShift);
    return noteName + octave;
}

// Convert notes to ABC notation per channel
const ppqn = midiData.header.ticksPerBeat;
const channelStrings = {};
for (const channel in notesByChannel) {
    const durations = notesByChannel[channel].map(note => note.duration);
    const baseNoteLength = findBaseNoteLength(durations);
    const noteStrings = notesByChannel[channel].map((note, i) => {
        if (typeof note.pitch === 'undefined') {
            return '';
        }
        const pitch = midiNoteToAbcPitch(note.pitch);
        const duration = midiDurationToAbcDuration(note.duration, baseNoteLength);

        // Check for rests
        const prevNoteEndTime = i > 0 ? notesByChannel[channel][i - 1].startTime + notesByChannel[channel][i - 1].duration : 0;
        const restDuration = midiDurationToAbcDuration(note.startTime - prevNoteEndTime, baseNoteLength * ppqn);
        const restString = restDuration ? `z${restDuration} ` : '';

        return restString + pitch + duration;
    });

    channelStrings[channel] = noteStrings.join(' ');
}

const baseName = fileName.split('\\').pop().split('/').pop().replace(/\..+$/, '');
const header = `X:1
T:${baseName}
M:C
L:1/4
K:C
Q:${Math.round(tempo)}
`;
const abcNotation = Object.values(channelStrings).join('\n| ');
console.log(header + abcNotation);
