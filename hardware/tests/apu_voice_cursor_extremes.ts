// Optional extended stress: full 32-bit start/frame/loop/rate words through
// the actual mixer. No clamp; valid and out-of-range loop inputs are retained.
import { ApuOutputMixer } from '../../machine/ts/machine/devices/audio/output.ts';
import { resolveApuPhaseStep } from '../../machine/ts/machine/devices/audio/playback.ts';
import { APU_PARAMETER_REGISTER_COUNT, APU_PARAMETER_RATE_STEP_Q16_INDEX,
 APU_PARAMETER_START_SAMPLE_INDEX, APU_PARAMETER_GAIN_Q12_INDEX } from '../../machine/ts/spec/audio/apu.ts';
const cases=2048, frames=8;let seed=0x73f421ab;
function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
function word(x:number){return (x>>>0).toString(16).padStart(8,'0');}
function wide(x:number){return BigInt.asUintN(64,BigInt(x)).toString(16).padStart(16,'0');}
process.stdout.write(`${cases} ${frames}\n`);
for(let c=0;c<cases;c++){
 let start=random(),count=random(),lo=random(),hi=random();
 let rate=[0,0x10000,0xffff0000,0x8000,0x20000,0x7fffffff,0x80000000,random()][c%8]!;
 let hz=[0,8000,22050,44100,48000,96000,0xffffffff,random()][(c>>3)%8]!;
 if(c===0){start=1;count=16;lo=4;hi=8;rate=0x10000;hz=44100;}
 if(c===1){start=7;count=16;lo=4;hi=8;rate=0x8000;hz=44100;}
 if(c===2){start=4;count=16;lo=4;hi=8;rate=0xffff0000;hz=44100;}
 if(c===3){start=0xffffffff;count=16;lo=4;hi=8;rate=0x80000000;hz=0xffffffff;}
 if(c===4){start=0;count=1;lo=0;hi=0;rate=0x10000;hz=44100;}
 if(c===5){start=0;count=0xffffffff;lo=0;hi=1;rate=0x7fffffff;hz=0xffffffff;}
 if(c===6){start=0xffffffff;count=0xffffffff;lo=0xfffffffe;hi=0xffffffff;rate=0x80000000;hz=0xffffffff;}
 const mixer=new ApuOutputMixer();const regs=new Uint32Array(APU_PARAMETER_REGISTER_COUNT);
 regs[APU_PARAMETER_START_SAMPLE_INDEX]=start;regs[APU_PARAMETER_RATE_STEP_Q16_INDEX]=rate;regs[APU_PARAMETER_GAIN_Q12_INDEX]=4096;
 const source={sourceAddr:0,sourceBytes:0,sampleRateHz:hz,channels:1,bitsPerSample:16,frameCount:count,dataOffset:0,dataBytes:0,loopStartSample:lo,loopEndSample:hi,generatorKind:1,generatorDutyQ12:2048};
 mixer.playVoice(0,source,{bytes:new Uint8Array(0),byteOffset:0,byteLength:0,cartridgeSlot:0},regs);
 const rateState={wholeQ16:0,remainder:0};resolveApuPhaseStep(rateState,rate,hz);
 process.stdout.write([word(start),word(count),word(lo),word(hi),word(rate),word(hz),wide(rateState.wholeQ16),word(rateState.remainder)].join(' ')+'\n');
 for(let f=0;f<frames;f++){
  const record=(mixer as unknown as {voices:{active:boolean,cursorQ16:number,phaseRemainder:number}[]}).voices[0]!;
  const was=record.active;let position=record.cursorQ16,render=was;
  if(hi>lo){const length=(hi-lo)*65536;let rem=(position-lo*65536)%length;if(rem<0)rem+=length;position=lo*65536+rem;}
  else if(position<0||position>=count*65536)render=false;
  const cur=render?(position-position%65536)/65536:0;
  let next=cur+1;if(render){if(hi>lo&&next>=hi)next=lo;else if(hi<=lo&&next>=count)next=cur;}
  const frac=render?position%65536:0;
  const ended=mixer.renderMachineFrames(1,f)&1;const packed=mixer.outputRing.readFramePacked();
  process.stdout.write([word(was?1:0),word(render?1:0),word(ended),word(cur),word(render?next:0),word(frac),wide(record.cursorQ16),word(record.phaseRemainder),word(packed)].join(' ')+'\n');
 }
}
