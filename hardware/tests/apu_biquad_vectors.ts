// Stimuli and expected samples from the actual TS biquad owner. State remains
// independent for each of sixteen slots; bypass does not process the filter.
import { BiquadFilterState } from '../../machine/ts/machine/devices/audio/biquad_filter';
import { highSignedHalfword, lowSignedHalfword } from '../../machine/ts/machine/common/numeric';
const states = Array.from({length:16}, () => new BiquadFilterState());
let seed = 0x91badcfe;
function random(): number { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }
function hex(v:number):string { return (v >>> 0).toString(16).padStart(8,'0'); }
const count=4096;
process.stdout.write(`${count}\n`);
for(let i=0;i<count;i++) {
 const slot=i<16 ? i : i<20 ? 0 : random()&15;
 const clear=i<=16 || (i>=20 && (random()&31)===0);
 let control=random(),b01=random(),b2a1=random(),a2=random(),samples=random();
 if(i>=16 && i<20) { control=1; b01=0x20002000;b2a1=0;a2=0;samples=[0x20002000,0,0xe000e000,0][i-16]; }
 const state=states[slot]!;
 if(clear) state.reset();
 state.configure(control,b01,b2a1,a2);
 let result=samples;
 if(state.enabled) {
  state.processStereo(lowSignedHalfword(samples),highSignedHalfword(samples));
  result=(state.outputLeft&0xffff)|((state.outputRight&0xffff)<<16);
 }
 if(i>=16 && i<20 && (result>>>0)!==[0x10001000,0x10001000,0xf000f000,0xf000f000][i-16])
  throw new Error(`moving-average case ${i}`);
 process.stdout.write(`${clear?1:0} ${slot.toString(16)} ${hex(control)} ${hex(b01)} ${hex(b2a1)} ${hex(a2)} ${hex(samples)} ${hex(result)}\n`);
}
