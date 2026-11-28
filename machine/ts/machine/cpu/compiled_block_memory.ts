import { IO_SLOT_COUNT } from '../../spec/bmsx/io';
import { CART_ROM_BASE, CART_ROM_SIZE, CPU_FIXED_FRAME_ADDRESS, CPU_FIXED_VALUE_END, CPU_RESET_BANK_ADDRESS, CPU_RESET_BANK_END, IO_WORD_SIZE, MAIN_RAM_SIZE, RAM_BASE, SYSTEM_ROM_SIZE } from '../../spec/bmsx/memory_map';
import { COP0_STATUS, CPU_STATUS_USER_MODE_CURRENT } from '../../spec/blua32/cop0';
import { MEMORY_ACCESS_KIND_ALIGNMENT_MASKS, MemoryAccessKind, VALUE_MEMORY_SIZE, VALUE_MEMORY_TAG_OFFSET, type ScalarMemoryAccessKind } from '../../spec/blua32/memory_access_kind';
import { OpCode } from '../../spec/blua32/opcode';
import { MAPPED_PAGE_BYTE_SHIFT } from '../memory/mapped_page';
import { ValueTag } from './value';
import type { DecodedInstructionPage } from './execution_image';
import type { Memory } from '../memory/memory';
import type { JavaScriptRegisterCache } from './compiled_block_registers';
import { THREAD_HEAP_BYTES } from './thread_record';

const viewMethods = ['Uint32', 'Uint8', 'Uint16', 'Uint32', 'Uint32', 'Float64'] as const;
const widths = [4, 1, 2, 4, 4, 8] as const;

/** The entire counted span must be unwatched, cartridge-visible main RAM. */
export function emitWordStores(page: DecodedInstructionPage, word: number, address: string, exit: string,
	numericFault: string, registers: JavaScriptRegisterCache): string {
	const count = page.c[word], source = page.a[word];
	if (count === 0) return `{const a=${address}; if((a&3)!==0) ${exit}}`;
	return `{const a=${address},o=(a-${RAM_BASE})>>>0;
if((a&3)!==0||o<${IO_SLOT_COUNT * IO_WORD_SIZE}||o+${count * 4}>h.ramBusEnd()-${RAM_BASE}) ${exit}
const end=(o+${count * 4 - 4})>>>${MAPPED_PAGE_BYTE_SHIFT};
for(let p=o>>>${MAPPED_PAGE_BYTE_SHIFT};p<=end;++p) if(g[p]!==0) ${exit}
${registers.publishRange(source, source + count)}
B-=${count};
for(let i=0;i<${count};++i){const tag=r.t(${source}+i),word=r.p(${source}+i);
const v=tag===${ValueTag.Integer}?word:(tag===${ValueTag.Float}?fw(word):null);if(v===null) ${numericFault} m.setUint32(o+i*4,v,true);}}`;
}

function emitRomStorageRead(storage: string, read: string, width: number, exit: string): string {
	return `const d=${storage}.view; if(o+${width}>d.byteLength) ${exit} ${read}`;
}

/** The source instruction is in System ROM. Check live mode and the whole RAM cell before either lane. */
export function emitValueMemoryAccess(load: boolean, slot: number, address: string, exit: string, registers: JavaScriptRegisterCache): string {
	const alignment = MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[MemoryAccessKind.Value];
	const mask = MAIN_RAM_SIZE - 1;
	const guard = `{const a=${address},o=(a-${RAM_BASE})>>>0,end=o+${VALUE_MEMORY_SIZE},tag=o+${VALUE_MEMORY_TAG_OFFSET};
if((a&${alignment})!==0||(cp[${COP0_STATUS}]&${CPU_STATUS_USER_MODE_CURRENT})!==0
||o<${IO_SLOT_COUNT * IO_WORD_SIZE}||end>m.byteLength
||(o<${CPU_FIXED_VALUE_END - RAM_BASE}&&end>${CPU_FIXED_FRAME_ADDRESS - RAM_BASE})
||(o<${CPU_RESET_BANK_END - RAM_BASE}&&end>${CPU_RESET_BANK_ADDRESS - RAM_BASE})
||(ca&&(((tag-vs)&${mask})<vl||((tag-fs)&${mask})<fl||((tag-cs)&${mask})<${THREAD_HEAP_BYTES + VALUE_MEMORY_TAG_OFFSET}))) ${exit}`;
	if (load) return `${guard}${registers.writeEncoded(slot, 'm.getUint8(tag)', 'm.getUint32(o,true)')}}`;
	return `${guard}
if((g[o>>>${MAPPED_PAGE_BYTE_SHIFT}]|g[tag>>>${MAPPED_PAGE_BYTE_SHIFT}])!==0) ${exit}
m.setUint32(o,${registers.wordOperand(slot)},true);m.setUint8(tag,${registers.tagOperand(slot)});}`;
}

/** Backed RAM/ROM stay in generated code; bus-visible accesses exit before acting. */
export function emitMemoryAccess(page: DecodedInstructionPage, word: number, address: string, exit: string,
	numericFault: string, memory: Memory, registers: JavaScriptRegisterCache): string {
	const load = page.ops[word] === OpCode.LOAD_MEM || page.ops[word] === OpCode.LOAD_MEM_D;
	const kind = page.c[word] as ScalarMemoryAccessKind;
	const width = widths[kind], a = page.a[word];
	const endian = width === 1 ? '' : ',true';
	const alignment = MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[kind];
	if (load) {
		const read = `v=${kind === MemoryAccessKind.F64LE ? 'fr(' : ''}d.get${viewMethods[kind]}(o${endian})${kind === MemoryAccessKind.F64LE ? ')' : ''};`;
		const slot0 = memory.cartridgeController.romStorage(0) === null ? exit : emitRomStorageRead('c0', read, width, exit);
		const slot1 = memory.cartridgeController.romStorage(1) === null ? exit : emitRomStorageRead('c1', read, width, exit);
		const result = kind === MemoryAccessKind.F32LE || kind === MemoryAccessKind.F64LE
			? registers.writeFloatBits(a, 'v') : registers.writeInteger(a, 'v');
		return `{const a=${address}; let o=(a-${RAM_BASE})>>>0,v;
${alignment === 0 ? '' : `if((a&${alignment})!==0) ${exit}`}
if(o>=${IO_SLOT_COUNT * IO_WORD_SIZE}&&o+${width}<=h.ramBusEnd()-${RAM_BASE}){const d=m; ${read}}
else if(a<=${SYSTEM_ROM_SIZE - width}){o=a; ${emitRomStorageRead('s', read, width, exit)}}
else {o=(a-${CART_ROM_BASE})>>>0; if(o>${CART_ROM_SIZE - width}) ${exit}
if(c.selectedSlot()===0){${slot0}}else{${slot1}}}${result}}`;
	}
	const watches = `||g[o>>>${MAPPED_PAGE_BYTE_SHIFT}]!==0`
		+ (width === 8 ? `||g[(o+4)>>>${MAPPED_PAGE_BYTE_SHIFT}]!==0` : '');
	const guard = `{const a=${address}; const o=(a-${RAM_BASE})>>>0;
if(${alignment === 0 ? '' : `(a&${alignment})!==0||`}o<${IO_SLOT_COUNT * IO_WORD_SIZE}||o+${width}>h.ramBusEnd()-${RAM_BASE}${watches}) ${exit}`;
	const tag = registers.tagOperand(a), value = registers.wordOperand(a);
	let conversion: string;
	if (kind === MemoryAccessKind.F32LE) conversion = `const mt=${tag},mw=${value};if(mt!==${ValueTag.Integer}&&mt!==${ValueTag.Float}) ${numericFault}const v=mt===${ValueTag.Integer}?fb(mw|0):mw;`;
	else if (kind === MemoryAccessKind.F64LE) conversion = `const mt=${tag},mw=${value};if(mt!==${ValueTag.Integer}&&mt!==${ValueTag.Float}) ${numericFault}const v=mt===${ValueTag.Integer}?mw|0:bf(mw);`;
	else conversion = `const v=${tag}===${ValueTag.Integer}?${value}:(${tag}===${ValueTag.Float}?fw(${value}):null);if(v===null) ${numericFault}`;
	return `${guard}${conversion}m.set${viewMethods[kind]}(o,v${endian});}`;
}
