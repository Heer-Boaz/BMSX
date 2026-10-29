// Two frames of PCM and BADP with an intervening committed PCM-word update.
import {writeLE16,writeLE32} from '../../machine/ts/common/endian';
import {ApuOutputMixer} from '../../machine/ts/machine/devices/audio/output';
import {APU_PARAMETER_REGISTER_COUNT,APU_PARAMETER_GAIN_Q12_INDEX} from '../../machine/ts/spec/audio/apu';
const bytes=new Uint8Array(512),mixer=new ApuOutputMixer(),regs=new Uint32Array(APU_PARAMETER_REGISTER_COUNT);
regs[APU_PARAMETER_GAIN_Q12_INDEX]=4096;writeLE32(bytes,64,0x000c0008);writeLE32(bytes,68,0x00140064);writeLE32(bytes,72,0x11111111);writeLE16(bytes,400,1000);
const pcm={sourceAddr:0x40000190,sourceBytes:4,sampleRateHz:44100,channels:1,bitsPerSample:16,frameCount:8,dataOffset:0,dataBytes:4,loopStartSample:0,loopEndSample:8,generatorKind:0,generatorDutyQ12:0};
const badp={...pcm,sourceAddr:0x40000000,sourceBytes:128,bitsPerSample:4,dataOffset:64,dataBytes:12};
mixer.playVoice(0,pcm,{bytes,byteOffset:400,byteLength:4,cartridgeSlot:0},regs);mixer.playVoice(1,badp,{bytes,byteOffset:0,byteLength:128,cartridgeSlot:0},regs);
process.stdout.write('2\n');for(let e=0;e<2;e++){if(e===1)writeLE16(bytes,400,3000);mixer.renderMachineFrames(1,e);process.stdout.write(mixer.outputRing.readFramePacked().toString(16).padStart(8,'0')+'\n');}
