// Produce operations and expectations from the real TypeScript memory and
// SystemDebugTransmit owners. Concurrent sink transfers occur before writes,
// matching the RTL interface's specified ordering at the accepting edge.
import { Memory } from '../../machine/ts/machine/memory/memory';
import { SystemDebugTransmit } from '../../machine/ts/machine/devices/system/debug_transmit';
import { IO_SYS_PRINT_CHAR, IO_SYS_PRINT_FLUSH } from '../../machine/ts/spec/bmsx/io';

const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: [null, null] }, 4096);
const tx = new SystemDebugTransmit(memory);
tx.reset();
let seed = 0xfacade57;
function next(): number { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }
function emit(op: number, word = 0): void {
    let expected = 0;
    switch (op) {
        case 0: memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, word); break;
        case 1: memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, word); break;
        case 2: expected = memory.readMappedU32LE(IO_SYS_PRINT_CHAR); break;
        case 3: expected = memory.readMappedU32LE(IO_SYS_PRINT_FLUSH); break;
        case 4: expected = tx.readByte(); break;
        case 5: tx.reset(); break;
        case 6: expected = tx.readByte(); memory.writeMappedU32LE(IO_SYS_PRINT_CHAR, word); break;
        case 7: expected = tx.readByte(); memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH, word); break;
        case 8: expected = tx.availableByteCount(); break;
    }
    process.stdout.write(`${op} ${(word >>> 0).toString(16)} ${(expected >>> 0).toString(16)}\n`);
}
function drain(): void { while (tx.availableByteCount() !== 0) emit(4); }
function chars(n: number, value: number): void { for(let i=0; i<n; i++) emit(0,value); }
const edges = [0,0x7f,0x80,0x7ff,0x800,0xd7ff,0xd800,0xdfff,0xe000,0xffff,0x10000,0x10ffff,0x110000,0xffffffff];
for(const c of edges) emit(0,c);
emit(2);emit(1,0x12345678);emit(3);emit(8);drain();
// Published data survives overflow of a partially written line.
emit(0,0x4f);emit(0,0x4b);emit(1);chars(8192,0x41);emit(8);emit(0,0x1f600);emit(2);emit(1);emit(8);drain();
// A full ring transfers a published byte and appends a new character on the
// same clock. Later flush publishes the new partial byte at the ring wrap.
chars(8191,0x42);emit(1);emit(6,0x43);emit(8);drain();emit(1);emit(8);drain();
// LF overflow, complete output coexisting with a failed multi-octet reserve.
chars(8192,0x44);emit(1);emit(8);chars(8188,0x45);emit(1);emit(0,0x1f600);emit(1);emit(8);drain();
// Mixed traffic spans empty/partial/published buffers, backpressure and reset.
for(let i=0;i<12000;i++) {
    const choice=next()%32;
    if(choice<16) emit(0,(choice<8 ? edges[next()%edges.length] : next()));
    else if(choice<19) emit(1,next());
    else if(choice<21) emit(2);
    else if(choice<23) emit(3);
    else if(choice<27 && tx.availableByteCount()!==0) emit(4);
    else if(choice<29 && tx.availableByteCount()!==0) emit(6,edges[next()%edges.length]);
    else if(choice<30 && tx.availableByteCount()!==0) emit(7,next());
    else if(choice===30) emit(8);
    else emit(5);
}
emit(8);drain();emit(8);
