// Exact PCM output oracle: real TypeScript PCM decoder, indexed byte data.
import { readApuPcmSample } from '../../machine/ts/machine/devices/audio/pcm_decoder_hot_path';
const bytes = new Uint8Array(128);
for (let i=0;i<bytes.length;i++) bytes[i]=(i*73+91)&255;
const channels=[1,2,0,0xffffffff];
const depths=[8,16,0,0xffffffff];
process.stdout.write(`${124*channels.length*depths.length}\n`);
for(let address=0;address<124;address++) for(const ch of channels) for(const bits of depths) {
 const left=readApuPcmSample(bytes,address,bits===16,0);
 const right=ch===1 ? left:readApuPcmSample(bytes,address,bits===16,1);
 const packed=(((right&0xffff)<<16)|(left&0xffff))>>>0;
 process.stdout.write(`${address.toString(16)} ${ch.toString(16)} ${bits.toString(16)} ${packed.toString(16).padStart(8,'0')}\n`);
}
