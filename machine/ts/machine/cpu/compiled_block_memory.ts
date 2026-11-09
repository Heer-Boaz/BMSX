import { IO_SLOT_COUNT } from '../../spec/bmsx/io';
import { CART_ROM_BASE, CART_ROM_SIZE, IO_WORD_SIZE, RAM_BASE, SYSTEM_ROM_SIZE } from '../../spec/bmsx/memory_map';
import { MEMORY_ACCESS_KIND_ALIGNMENT_MASKS, MemoryAccessKind } from '../../spec/blua32/memory_access_kind';
import { OpCode } from '../../spec/blua32/opcode';
import { MAPPED_PAGE_BYTE_SHIFT } from '../memory/mapped_page';
import type { DecodedInstructionPage } from './execution_image';
import type { Memory } from '../memory/memory';

const viewMethods = ['Uint32', 'Uint8', 'Uint16', 'Uint32', 'Float32', 'Float64'] as const;
const widths = [4, 1, 2, 4, 4, 8] as const;

function emitRomStorageRead(storage: string, read: string, width: number, exit: string): string {
	return `const d=${storage}.view; if(o+${width}>d.byteLength) ${exit} ${read}`;
}

/** Backed RAM/ROM stay in generated code; bus-visible accesses exit before acting. */
export function emitMemoryAccess(page: DecodedInstructionPage, word: number, address: string, exit: string,
	memory: Memory, value: string): string {
	const load = page.ops[word] === OpCode.LOAD_MEM || page.ops[word] === OpCode.LOAD_MEM_D;
	const kind = page.c[word] as MemoryAccessKind;
	const width = widths[kind];
	const endian = width === 1 ? '' : ',true';
	const alignment = MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[kind];
	if (load) {
		const read = `v=d.get${viewMethods[kind]}(o${endian});`;
		const slot0 = memory.cartridgeController.romStorage(0) === null ? 'v=0;' : emitRomStorageRead('c0', read, width, exit);
		const slot1 = memory.cartridgeController.romStorage(1) === null ? 'v=0;' : emitRomStorageRead('c1', read, width, exit);
		return `{const a=${address}; let o=(a-${RAM_BASE})>>>0;
${alignment === 0 ? '' : `if((a&${alignment})!==0) ${exit}`}
if(o>=${IO_SLOT_COUNT * IO_WORD_SIZE}&&o<=m.byteLength-${width}){const d=m; ${read}}
else if(a<=${SYSTEM_ROM_SIZE - width}){o=a; ${emitRomStorageRead('s', read, width, exit)}}
else {o=(a-${CART_ROM_BASE})>>>0; if(o>${CART_ROM_SIZE - width}) ${exit}
if(c.selectedSlot()===0){${slot0}}else{${slot1}}}}`;
	}
	const watches = `||g[o>>>${MAPPED_PAGE_BYTE_SHIFT}]!==0`
		+ (width === 8 ? `||g[(o+4)>>>${MAPPED_PAGE_BYTE_SHIFT}]!==0` : '');
	const guard = `{const a=${address}; const o=(a-${RAM_BASE})>>>0;
if(${alignment === 0 ? '' : `(a&${alignment})!==0||`}o<${IO_SLOT_COUNT * IO_WORD_SIZE}||o>m.byteLength-${width}${watches}) ${exit}`;
	return `${guard}m.set${viewMethods[kind]}(o,${value}${endian});}`;
}
