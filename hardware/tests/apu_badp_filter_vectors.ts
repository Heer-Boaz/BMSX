// The actual TS APU mixer supplies complete BADP/filter/mix expected frames.
import { writeLE16,writeLE32,readLE32 } from '../../machine/ts/common/endian';
import { ApuOutputMixer } from '../../machine/ts/machine/devices/audio/output';
import { APU_PARAMETER_REGISTER_COUNT,APU_PARAMETER_GAIN_Q12_INDEX,APU_PARAMETER_RATE_STEP_Q16_INDEX,
 APU_PARAMETER_START_SAMPLE_INDEX,APU_PARAMETER_FILTER_CONTROL_INDEX,APU_PARAMETER_FILTER_B0_B1_INDEX,
 APU_PARAMETER_FILTER_B2_A1_INDEX,APU_PARAMETER_FILTER_A2_INDEX } from '../../machine/ts/spec/audio/apu';
const frames=32,voices=8,channels=2,stride=128,blockBytes=4+8*channels,sourceBytes=72+blockBytes;
const bytes=new Uint8Array(stride*voices), mixer=new ApuOutputMixer();
const gains=[4096,2048,-2048,1024,8192,-4096,3333,777];
const regs=[], sources=[],views=[];
for(let v=0;v<voices;v++){
 const base=v*stride;writeLE32(bytes,base+28,1);writeLE32(bytes,base+32,64);writeLE32(bytes,base+64,0);writeLE32(bytes,base+68,0);
 const b=base+72;writeLE16(bytes,b,8);writeLE16(bytes,b+2,blockBytes);writeLE16(bytes,b+4,v*2137-7800);bytes[b+6]=20+v;
 writeLE16(bytes,b+8,10000-v*1733);bytes[b+10]=25+v;
 for(let n=0;n<8;n++)bytes[b+12+n]=(v*29+n*37+0x21)&255;
 const r=new Uint32Array(APU_PARAMETER_REGISTER_COUNT);r[APU_PARAMETER_RATE_STEP_Q16_INDEX]=0x8000;r[APU_PARAMETER_START_SAMPLE_INDEX]=1;
 r[APU_PARAMETER_GAIN_Q12_INDEX]=gains[v]>>>0;r[APU_PARAMETER_FILTER_CONTROL_INDEX]=v===7?0:1;
 r[APU_PARAMETER_FILTER_B0_B1_INDEX]=[0x20002000,0x7fff7fff,0x40004000,0x10002000,0,0x80008000,0x4000,0x20002000][v]>>>0;
 r[APU_PARAMETER_FILTER_B2_A1_INDEX]=[0,0x80004000,0,0xf0000800,0,0x20004000,0x80000000,0][v]>>>0;
 r[APU_PARAMETER_FILTER_A2_INDEX]=[0,0x8000,0,0x1000,0,0x4000,0,0][v];
 const source={sourceAddr:0x40000000+base,sourceBytes,sampleRateHz:44100,channels,bitsPerSample:4,frameCount:8,dataOffset:72,dataBytes:blockBytes,loopStartSample:1,loopEndSample:7,generatorKind:0,generatorDutyQ12:0};
 const view={bytes,byteOffset:base,byteLength:sourceBytes,cartridgeSlot:0};regs.push(r);sources.push(source);views.push(view);mixer.playVoice(v,source,view,r);
}
process.stdout.write(`${frames} ${voices} ${bytes.length/4} ${channels}\n`);
for(let off=0;off<bytes.length;off+=4)process.stdout.write(`${readLE32(bytes,off).toString(16).padStart(8,'0')}\n`);
for(let epoch=0;epoch<frames;epoch++){
 if(epoch===8)regs[0]![APU_PARAMETER_FILTER_CONTROL_INDEX]=0;
 if(epoch===12)regs[0]![APU_PARAMETER_FILTER_CONTROL_INDEX]=1;
 if(epoch===16)regs[1]![APU_PARAMETER_FILTER_B0_B1_INDEX]=0x30001000;
 if(epoch===22)mixer.playVoice(2,sources[2]!,views[2]!,regs[2]!);
 if(epoch===26) {regs[3]![APU_PARAMETER_START_SAMPLE_INDEX]=3;mixer.writeSlotRegisterWord(3,sources[3]!,regs[3]!,APU_PARAMETER_START_SAMPLE_INDEX);}
 for(let v=0;v<voices;v++)mixer.writeSlotRegisterWord(v,sources[v]!,regs[v]!,APU_PARAMETER_FILTER_CONTROL_INDEX);
 const state=mixer.captureState();
 for(const v of state.voices){
  const loop=6*65536,relative=(v.cursorQ16-65536)%loop,cursor=65536+(relative<0?relative+loop:relative);
  const frac=cursor%65536,current=(cursor-frac)/65536,next=current+1>=7?1:current+1,r=regs[v.slot]!;
  const restart=epoch===0 || (epoch===22 && v.slot===2),seek=epoch===26 && v.slot===3;
  process.stdout.write(`${current} ${next} ${frac} ${(gains[v.slot]>>>0).toString(16)} ${restart||seek?1:0} ${r[APU_PARAMETER_FILTER_CONTROL_INDEX].toString(16)} ${r[APU_PARAMETER_FILTER_B0_B1_INDEX].toString(16)} ${r[APU_PARAMETER_FILTER_B2_A1_INDEX].toString(16)} ${r[APU_PARAMETER_FILTER_A2_INDEX].toString(16)} ${restart?1:0}\n`);
 }
 mixer.renderMachineFrames(1,epoch);process.stdout.write(`${mixer.outputRing.readFramePacked().toString(16).padStart(8,'0')}\n`);
}
