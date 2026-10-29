// FIFO order and 21-word snapshot oracle from the actual TypeScript owner.
import { ApuCommandFifo } from '../../machine/ts/machine/devices/audio/command_fifo';
import { APU_PARAMETER_REGISTER_COUNT } from '../../machine/ts/spec/audio/apu';
const q = new ApuCommandFifo();
const words = new Uint32Array(APU_PARAMETER_REGISTER_COUNT);
const out = new Uint32Array(APU_PARAMETER_REGISTER_COUNT);
const emit = () => { if (q.popInto(out) !== 1) throw new Error('unexpected command'); console.log(out[0]!.toString(16).padStart(8, '0')); };
for (let i=0;i<words.length;i++) words[i] = (0xa0000000+i) >>> 0;
q.enqueue(1, words);
words.fill(0);
if (q.count !== 1) throw new Error('first capture');
for(let i=0;i<out.length;i++) if(q.captureState().registerWords[i] !== ((0xa0000000+i) >>> 0)) throw new Error('snapshot changed');
emit();
for(let i=0;i<17;i++) {words[0]=i; q.enqueue(1,words);}
if(q.count!==16) throw new Error('overflow count');
for(let i=1;i<=16;i++) emit();
for(let i=0;i<16;i++) {words[0]=100+i;q.enqueue(1,words);}
emit();words[0]=200;q.enqueue(1,words);
for(let i=101;i<=115;i++) emit();
emit();
if(!q.empty) throw new Error('queue did not drain');
