// Golden responses from the actual TypeScript BADP owner. The declared source
// extent is four bytes; the decoder's programmed block starts at byte 64.
import { writeLE16,writeLE32 } from '../../machine/ts/common/endian';
import { createApuBadpDecoderState,resetApuBadpDecoder,readApuBadpFrameAt } from '../../machine/ts/machine/devices/audio/badp_decoder_hot_path';
const bytes=new Uint8Array(512);
writeLE16(bytes,64,8);writeLE16(bytes,66,12);writeLE16(bytes,68,100);bytes[70]=20;
bytes.fill(0x11,72,76);
const r={sourceBytes:bytes,dataOffset:64,frames:8,channels:1,badpSeekTable:{bytes,byteOffset:0,entryCount:0},badp:createApuBadpDecoderState()};
resetApuBadpDecoder(r,0);
for(const f of [0,1,2])process.stdout.write(`${(readApuBadpFrameAt(r,f)>>>0).toString(16)}\n`);
writeLE32(bytes,68,0x001403e8);
process.stdout.write(`${(readApuBadpFrameAt(r,0)>>>0).toString(16)}\n`);
writeLE32(bytes,68,0x00140064);
process.stdout.write(`${(readApuBadpFrameAt(r,0)>>>0).toString(16)}\n`);
process.stdout.write(`${(readApuBadpFrameAt(r,1)>>>0).toString(16)}\n`);
