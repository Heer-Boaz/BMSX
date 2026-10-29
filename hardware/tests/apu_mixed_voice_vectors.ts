// Mixed PCM8/PCM16/BADP voices against the actual TS mixer. Four sources
// share one sample image; PCM payloads deliberately start at odd offsets.
import {writeLE16,writeLE32,readLE32} from '../../machine/ts/common/endian';
import {ApuOutputMixer} from '../../machine/ts/machine/devices/audio/output';
import {APU_PARAMETER_REGISTER_COUNT,APU_PARAMETER_GAIN_Q12_INDEX,APU_PARAMETER_RATE_STEP_Q16_INDEX,
 APU_PARAMETER_START_SAMPLE_INDEX,APU_PARAMETER_FILTER_CONTROL_INDEX,APU_PARAMETER_FILTER_B0_B1_INDEX,
 APU_PARAMETER_FILTER_B2_A1_INDEX,APU_PARAMETER_FILTER_A2_INDEX} from '../../machine/ts/spec/audio/apu';
const frames=48,voices=6,stride=128,bytes=new Uint8Array(stride*voices),mixer=new ApuOutputMixer();
const bits=[8,8,16,16,4,4],channels=[1,2,1,2,1,2],offset=[3,3,3,3,72,72],gain=[4096,2048,-2048,3333,1024,-4096];
for(let v=0;v<voices;v++){
 const base=v*stride,ch=channels[v]!;
 if(bits[v]!==4){for(let i=0;i<64;i++)bytes[base+3+i]=(v*79+i*53+19)&255;}
 else {const blockBytes=4+8*ch;writeLE32(bytes,base+28,1);writeLE32(bytes,base+32,64);writeLE32(bytes,base+64,0);writeLE32(bytes,base+68,0);
  const b=base+72;writeLE16(bytes,b,8);writeLE16(bytes,b+2,blockBytes);writeLE16(bytes,b+4,v*2137-7800);bytes[b+6]=20+v;
  if(ch===2){writeLE16(bytes,b+8,10000-v*1733);bytes[b+10]=25+v;}
  for(let n=0;n<4*ch;n++)bytes[b+4+4*ch+n]=(v*29+n*37+0x21)&255;
 }
 const regs=new Uint32Array(APU_PARAMETER_REGISTER_COUNT);regs[APU_PARAMETER_RATE_STEP_Q16_INDEX]=0x8000;regs[APU_PARAMETER_START_SAMPLE_INDEX]=1;
 regs[APU_PARAMETER_GAIN_Q12_INDEX]=gain[v]!>>>0;regs[APU_PARAMETER_FILTER_CONTROL_INDEX]=v===1?0:1;
 regs[APU_PARAMETER_FILTER_B0_B1_INDEX]=0x20002000;regs[APU_PARAMETER_FILTER_B2_A1_INDEX]=0;regs[APU_PARAMETER_FILTER_A2_INDEX]=0;
 mixer.playVoice(v,{sourceAddr:0x40000000+base,sourceBytes:128,sampleRateHz:44100,channels:ch,bitsPerSample:bits[v]!,frameCount:8,
  dataOffset:offset[v]!,dataBytes:64,loopStartSample:1,loopEndSample:7,generatorKind:0,generatorDutyQ12:0},
  {bytes,byteOffset:base,byteLength:128,cartridgeSlot:0},regs);
}
process.stdout.write(`${frames} ${voices} ${bytes.length/4}\n`);
for(let off=0;off<bytes.length;off+=4)process.stdout.write(`${readLE32(bytes,off).toString(16).padStart(8,'0')}\n`);
for(let epoch=0;epoch<frames;epoch++){
 const state=mixer.captureState();for(const v of state.voices){const r=(v.cursorQ16-65536)%(6*65536),q=65536+(r<0?r+6*65536:r),frac=q%65536,cur=(q-frac)/65536,next=cur+1>=7?1:cur+1;
  process.stdout.write(`${cur} ${next} ${frac} ${(gain[v.slot]!>>>0).toString(16)}\n`);}
 mixer.renderMachineFrames(1,epoch);process.stdout.write(`${mixer.outputRing.readFramePacked().toString(16).padStart(8,'0')}\n`);
}
