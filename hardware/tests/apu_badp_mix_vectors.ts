// Complete mixer output oracle from the unchanged production TS owner. The
// source image contains independently bound mono or stereo BADP blocks, half-rate
// playback with a six-frame loop, and distinct per-slot signed gain words.
import { writeLE16, writeLE32, readLE32 } from '../../machine/ts/common/endian.ts';
import { ApuOutputMixer } from '../../machine/ts/machine/devices/audio/output.ts';
import { APU_PARAMETER_REGISTER_COUNT, APU_PARAMETER_GAIN_Q12_INDEX,
    APU_PARAMETER_RATE_STEP_Q16_INDEX, APU_PARAMETER_START_SAMPLE_INDEX } from '../../machine/ts/spec/audio/apu.ts';
const frames=48, voices=process.argv.includes('--voices=16') ? 16 : 8, stride=128;
const channels=process.argv.includes('--mono') ? 1 : 2;
const blockBytes=4+8*channels, sourceBytes=72+blockBytes;
const bytes=new Uint8Array(stride*voices);
const mixer=new ApuOutputMixer();
const gain=[4096,2048,-2048,1024,8192,-4096,3333,777];
for(let voice=0;voice<voices;voice++) {
 const base=voice*stride;
 writeLE32(bytes,base+28,1);writeLE32(bytes,base+32,64);
 writeLE32(bytes,base+64,0);writeLE32(bytes,base+68,0);
 const b=base+72;writeLE16(bytes,b,8);writeLE16(bytes,b+2,blockBytes);
 writeLE16(bytes,b+4,voice*2137-7800);bytes[b+6]=20+voice;
 if(channels===2) {writeLE16(bytes,b+8,10000-voice*1733);bytes[b+10]=25+voice;}
 for(let n=0;n<4*channels;n++) bytes[b+4+4*channels+n]=(voice*29+n*37+0x21)&255;
 const regs=new Uint32Array(APU_PARAMETER_REGISTER_COUNT);
 regs[APU_PARAMETER_RATE_STEP_Q16_INDEX]=0x8000;
 regs[APU_PARAMETER_START_SAMPLE_INDEX]=1;
 regs[APU_PARAMETER_GAIN_Q12_INDEX]=gain[voice%gain.length]>>>0;
 mixer.playVoice(voice,{sourceAddr:0x40000000+base,sourceBytes,sampleRateHz:44100,
  channels,bitsPerSample:4,frameCount:8,dataOffset:72,dataBytes:blockBytes,
  loopStartSample:1,loopEndSample:7,generatorKind:0,generatorDutyQ12:0},
  {bytes,byteOffset:base,byteLength:sourceBytes,cartridgeSlot:0},regs);
}
process.stdout.write(`${frames} ${voices} ${bytes.length/4} ${channels}\n`);
for(let offset=0;offset<bytes.length;offset+=4) process.stdout.write(`${readLE32(bytes,offset).toString(16).padStart(8,'0')}\n`);
for(let epoch=0;epoch<frames;epoch++) {
 const state=mixer.captureState();
 for(const v of state.voices) {
  const loop=6*65536; const relative=(v.cursorQ16-65536)%loop;
  const cursor=65536+(relative<0?relative+loop:relative);
  const frac=cursor%65536;const current=(cursor-frac)/65536;
  const next=current+1>=7?1:current+1;
  process.stdout.write(`${current} ${next} ${frac} ${(gain[v.slot%gain.length]>>>0).toString(16).padStart(8,'0')} ${epoch===0?1:0}\n`);
 }
 mixer.renderMachineFrames(1,epoch);
 process.stdout.write(`${mixer.outputRing.readFramePacked().toString(16).padStart(8,'0')}\n`);
}
