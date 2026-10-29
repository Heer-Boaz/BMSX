import { writeGenericCircuitRows } from '../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated';
import { GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA } from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
import {gxGpuLocalMemoryAddress32,gxGpuLocalMemoryAddress16,gxGpuLocalMemoryAddress16S,gxGpuLocalMemoryAddressGx16,gxGpuLocalMemoryAddressGpu24} from '../../machine/ts/machine/devices/gx/gpu_local_memory';
let seed=0x8a7b2913; function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
function hex(v:number){return (v>>>0).toString(16).padStart(8,'0');}
function word(a:number){const index=a>>>1; return (((a&1)?0xa5a5:0x5a5a)^(index&0xffff)^(index>>>16))&0xffff;}
const vram=new Uint16Array(1<<20);for(let i=0;i<vram.length;i++)vram[i]=word(i);
const software={vram,vramWordMask:0xfffff};const state={width:1};const scanout={outputRowStep:1};const target=new Uint32Array(1);
const count=4096, formats=[0,1,2,10,18,31,3,30];process.stdout.write(`${count}\n`);
for(let n=0;n<count;n++){
 const psm=formats[n&7]!, circuit=(n>>>3)&1,fbp=random()&511,fbw=n%19===0?0:random()&63;
 const x=random(),y=random(),base=fbp<<12;let a=0,b=0,need=1;
 if(psm===0||psm===1)a=gxGpuLocalMemoryAddress32(base,fbw,x,y);
 else if(psm===2)a=gxGpuLocalMemoryAddress16(base,fbw,x,y);
 else if(psm===10)a=gxGpuLocalMemoryAddress16S(base,fbw,x,y);
 else if(psm===31)a=gxGpuLocalMemoryAddressGx16(base,fbw*64,x,y);
 else if(psm===18&&circuit===0){a=gxGpuLocalMemoryAddressGpu24(base,fbw,x,y,0);b=gxGpuLocalMemoryAddressGpu24(base,fbw,x,y,1);need=2;}
 else need=0;
 const framebufferStoragePath=psm===0?0:psm===1?1:psm===2?2:psm===10?3:psm===18&&!circuit?4:psm===31?5:6;
 const c={framebufferStoragePath,framebufferBaseWord:base,framebufferPagesPerRow:fbw,framebufferWidth:fbw*64,
  framebufferX:x,framebufferY:y,displayX:0,displayRight:1,fieldDisplayY:0,fieldDisplayLineCount:1,
  sourcePhaseX:0,sourceDivisionMultiplierX:1<<18,magnificationX:1,sourceAdvanceX:1,sourceRemainderStepX:0,
  fieldSourceNumeratorY:0,fieldSourceDivisionMultiplierY:1<<18,fieldSourceStride:1,fieldSourcePhase:0,fieldSourceNumeratorStepY:1};
 target[0]=0xdeadbeef;
 writeGenericCircuitRows(software as never,state as never,target,scanout as never,c as never,GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA);
 const rgba=target[0]!;
 const disp=(psm<<15)|(fbw<<9)|fbp;
 process.stdout.write(`${circuit} ${hex(disp)} ${hex(x)} ${hex(y)} ${need} ${hex(a>>>1)} ${hex(b>>>1)} ${hex(rgba)}\n`);
}
