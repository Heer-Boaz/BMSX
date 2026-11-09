import { IO_SLOT_COUNT } from '../../spec/bmsx/io';
import { IO_WORD_SIZE, RAM_BASE } from '../../spec/bmsx/memory_map';
import { MEMORY_ACCESS_KIND_ALIGNMENT_MASKS, MemoryAccessKind } from '../../spec/blua32/memory_access_kind';
import { OpCode } from '../../spec/blua32/opcode';
import { MAPPED_PAGE_BYTE_SHIFT } from '../memory/mapped_page';
import type { DecodedInstructionPage } from './execution_image';

const viewMethods = ['Uint32', 'Uint8', 'Uint16', 'Uint32', 'Float32', 'Float64'] as const;
const widths = [4, 1, 2, 4, 4, 8] as const;

/** RAM hits stay in generated code; bus-visible accesses return before acting. */
export function emitMemoryAccess(page: DecodedInstructionPage, word: number, address: string, exit: number): string {
	const load = page.ops[word] === OpCode.LOAD_MEM || page.ops[word] === OpCode.LOAD_MEM_D;
	const kind = page.c[word] as MemoryAccessKind;
	const width = widths[kind];
	const endian = width === 1 ? '' : ',true';
	const alignment = MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[kind];
	const watches = load ? '' : `||g[o>>>${MAPPED_PAGE_BYTE_SHIFT}]!==0`
		+ (width === 8 ? `||g[(o+4)>>>${MAPPED_PAGE_BYTE_SHIFT}]!==0` : '');
	const guard = `{const a=${address}; const o=(a-${RAM_BASE})>>>0;
if(${alignment === 0 ? '' : `(a&${alignment})!==0||`}o<${IO_SLOT_COUNT * IO_WORD_SIZE}||o>m.byteLength-${width}${watches}) return ${exit};`;
	if (load) return `${guard}v=m.get${viewMethods[kind]}(o${endian});}`;
	return `${guard}m.set${viewMethods[kind]}(o,r.getNumber(${page.a[word]})${endian});}`;
}
