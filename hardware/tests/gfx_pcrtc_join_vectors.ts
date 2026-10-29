// Pair actual TS scanout samples with actual TS composition operations. The
// C++ oracle independently re-fetches the two source pixels before blending.
import { readFileSync } from 'node:fs';
import { writeGenericCircuitRows } from '../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated';
import { GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB as RGB,GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA as RGBA,
 GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA as ALPHA,GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB as SRC_RGB,
 GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGBA as SRC_RGBA,GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB as C_RGB,
 GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGBA as C_RGBA } from '../../machine/ts/machine/devices/gx/gpu_pcrtc';
const rows=readFileSync('build/tests/gfx-pcrtc-sample-vectors.txt','utf8').trim().split('\n').slice(1).map(s=>s.split(' ').map(x=>parseInt(x,16)>>>0));
const sat=process.argv.includes('--saturate');
const lanes=[rows.filter(v=>v[0]===0&&(!sat||((v[1]!>>>15)&31)===18)),rows.filter(v=>v[0]===1&&(!sat||((v[1]!>>>15)&31)===0))];
const count=sat?256:Math.min(lanes[0]!.length,lanes[1]!.length);
const vram=new Uint16Array(1<<20),software={vram,vramWordMask:0xfffff},state={width:1},target=new Uint32Array(1);
const circuit={framebufferStoragePath:0,framebufferBaseWord:0,framebufferPagesPerRow:1,framebufferWidth:64,
 framebufferX:0,framebufferY:0,displayX:0,displayRight:1,fieldDisplayY:0,fieldDisplayLineCount:1,
 sourcePhaseX:0,sourceDivisionMultiplierX:1<<18,magnificationX:1,sourceAdvanceX:1,sourceRemainderStepX:0,
 fieldSourceNumeratorY:0,fieldSourceDivisionMultiplierY:1<<18,fieldSourceStride:1,fieldSourcePhase:0,fieldSourceNumeratorStepY:1};
let seed=0x76e549ab;function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
function hex(v:number){return(v>>>0).toString(16).padStart(8,'0');}
process.stdout.write(`${count}\n`);
for(let n=0;n<count;n++){
 const p=lanes[0]![n]!,q=lanes[1]![n]!;let pm=sat?0x8003:((random()&0xffff0000)|(n&3)|(((n>>2)&7)<<5)|([0,1,127,128,254,255][n%6]!<<8));
 const bg=random();let in1=sat?1:(n>>5)&1;const in2=sat?1:(n>>6)&1;const c1=p[7]!,c2=q[7]!;
 if(!sat && n===0){pm=(pm&0xffff0000)|0x61;in1=1;}
 const amod=(pm>>>6)&1,slbg=(pm>>>7)&1,mmod=(pm>>>5)&1,alp=(pm>>>8)&255;target[0]=bg&0xffffff;
 const scanout={outputRowStep:1,blendAlpha:alp};
 function draw(pixel:number,path:number){vram[0]=pixel&65535;vram[1]=pixel>>>16;writeGenericCircuitRows(software as never,state as never,target,scanout as never,circuit as never,path);}
 if((pm&2)&&in2){if(!slbg)draw(c2,amod?RGBA:RGB);else if(amod)draw(c2,ALPHA);}
 if((pm&1)&&in1){if(!mmod)draw(c1,amod?SRC_RGB:SRC_RGBA);else if(alp===255)draw(c1,amod?RGB:RGBA);else if(alp===0){if(!amod)draw(c1,ALPHA);}else draw(c1,amod?C_RGB:C_RGBA);}
 const values=[n,pm,bg,in1,in2,p[1]!,p[2]!,p[3]!,c1,q[1]!,q[2]!,q[3]!,c2,target[0]!];
 process.stdout.write(values.map(hex).join(' ')+'\n');
}
