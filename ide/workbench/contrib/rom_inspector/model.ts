import { formatByteSize, formatNumberAsHex } from '../../../../machine/ts/common/byte_hex_string';
import type { CartRomHeader } from '../../../../machine/ts/rompack/format';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../../../machine/ts/spec/bmsx/memory_map';
import type { RomAsset } from '../../../../toolchain/ts/rompack/assets';
import { loadBlua32ToolingImage, type Blua32ToolingImage } from '../../../../toolchain/ts/rompack/blua32_media';
import { blua32SourceRangeAtPc } from '../../../../toolchain/ts/rompack/blua32_symbols';
import { indexBlua32FunctionInstructions } from '../../../../toolchain/ts/rompack/disassembler';
import { inspectRom, romAssetByteLength, romAssetRanges, type RomInspectionSection } from '../../../../toolchain/ts/rompack/inspection';
import type { ResourceDomain } from '../../../common/resource';
import type { InspectedProperty } from '../../ui/property_inspector/model';

export type RomInspectorSnapshot = {
	readonly domain: ResourceDomain;
	readonly label: string;
	readonly rom: Uint8Array;
	readonly header: CartRomHeader;
	readonly assets: readonly RomAsset[];
};
const ENTRY_ORDER = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export type RomInspectorMode = 'assets' | 'structure' | 'code';
export type RomInspectorSort = 'name' | 'type' | 'size' | 'offset';
export type RomInspectorRow = {
	readonly label: string;
	readonly type: string;
	readonly byteLength: number;
	readonly start: number | undefined;
	readonly end: number | undefined;
	readonly asset?: RomAsset;
	readonly functionIndex?: number;
	readonly sourcePath?: string;
	readonly searchText: string;
	readonly sizeText: string;
};

/** Immutable packed-media facts and retained table projection. No runtime execution state. */
export class RomInspectorModel {
	public readonly inspection;
	public readonly assets: readonly RomInspectorRow[];
	public readonly sections: readonly RomInspectorRow[];
	public readonly rows: RomInspectorRow[] = [];
	public mode: RomInspectorMode = 'assets';
	public filter = '';
	public sort: RomInspectorSort = 'name';
	public descending = false;
	public selected = -1;
	public revision = 0;
	public code: Blua32ToolingImage | null | undefined;
	public functions: readonly RomInspectorRow[] = [];
	public instructions: Uint32Array<ArrayBufferLike> = new Uint32Array(0);
	public readonly properties: InspectedProperty[] = [];
	private indexedFunction = -1;

	public constructor(public readonly snapshot: RomInspectorSnapshot) {
		this.inspection = inspectRom(snapshot.rom, snapshot.header, snapshot.assets);
		this.assets = snapshot.assets.map(asset => {
			const ranges = romAssetRanges(asset), first = ranges[0];
			const byteLength = romAssetByteLength(asset), sourcePath = asset.source_path;
			return { label: asset.resid, type: asset.type, byteLength, start: first?.start, end: first?.end, asset, sourcePath,
				searchText: `${asset.resid} ${asset.type} ${sourcePath ?? ''}`.toLowerCase(), sizeText: formatByteSize(byteLength) };
		});
		this.sections = this.inspection.sections.map(section => this.sectionRow(section));
		this.project();
	}
	private sectionRow(section: RomInspectionSection): RomInspectorRow {
		const label = section.asset === undefined ? section.kind : `${section.asset.resid} / ${section.buffer}`;
		const byteLength = section.end - section.start;
		return { label, type: section.kind, byteLength, start: section.start, end: section.end, asset: section.asset,
			sourcePath: section.asset?.source_path, searchText: `${label} ${section.kind}`.toLowerCase(), sizeText: formatByteSize(byteLength) };
	}
	public get selection(): RomInspectorRow | undefined { return this.rows[this.selected]; }
	public setMode(mode: RomInspectorMode): void {
		if (this.mode === mode) return;
		this.mode = mode;
		if (mode === 'code' && this.code === undefined) this.loadCode();
		this.selected = -1;
		this.project();
	}
	private loadCode(): void {
		const snapshot = this.snapshot;
		this.code = loadBlua32ToolingImage({ bytes: snapshot.rom, header: snapshot.header }, snapshot.domain === -1 ? SYSTEM_ROM_BASE : CART_ROM_BASE, snapshot.assets);
		if (this.code === null) return;
		const code = this.code;
		const base = snapshot.domain === -1 ? SYSTEM_ROM_BASE : CART_ROM_BASE;
		this.functions = code.layout.functions.map((fn, functionIndex) => {
			const label = code.symbols === null ? formatNumberAsHex(fn.address, 8) : code.symbols.metadata.functionIds[functionIndex];
			const sourcePath = code.symbols === null ? undefined : blua32SourceRangeAtPc(code.symbols, code.layout.header.textAddress, fn.codeAddress)?.path;
			return { label, type: 'function', byteLength: fn.codeByteCount, start: fn.codeAddress - base, end: fn.codeAddress + fn.codeByteCount - base,
				functionIndex, sourcePath, searchText: `${label} ${sourcePath ?? ''}`.toLowerCase(), sizeText: formatByteSize(fn.codeByteCount) };
		});
	}
	public project(): void {
		const selected = this.selection;
		const source = this.mode === 'assets' ? this.assets : this.mode === 'structure' ? this.sections : this.functions;
		const query = this.filter.trim().toLowerCase();
		this.rows.length = 0;
		for (const row of source) if (query === '' || row.searchText.includes(query)) this.rows.push(row);
		const direction = this.descending ? -1 : 1;
		if (this.mode !== 'structure') this.rows.sort((left, right) => {
			const order = this.sort === 'size' ? left.byteLength - right.byteLength
				: this.sort === 'offset' ? (left.start === undefined ? -1 : left.start) - (right.start === undefined ? -1 : right.start)
					: this.sort === 'type' ? ENTRY_ORDER.compare(left.type, right.type) : ENTRY_ORDER.compare(left.label, right.label);
			return direction * (order || ENTRY_ORDER.compare(left.label, right.label));
		});
		const index = selected === undefined ? -1 : this.rows.indexOf(selected);
		this.select(index >= 0 ? index : this.rows.length === 0 ? -1 : 0);
	}
	public select(index: number): void {
		this.selected = index;
		this.revision += 1;
		this.properties.length = 0;
		const row = this.selection;
		if (row === undefined) return;
		this.properties.push({ warning: false, label: 'Name', value: row.label, description: row.type },
			{ warning: false, label: 'Stored bytes', value: `${row.byteLength} (${row.sizeText})`, description: this.mode === 'assets' ? 'Includes metadata' : '' });
		if (row.start !== undefined) this.properties.push({ warning: false, label: 'File range', value: `${formatNumberAsHex(row.start, 8)} .. ${formatNumberAsHex(row.end!, 8)}`, description: 'End exclusive' });
		if (row.sourcePath !== undefined) this.properties.push({ warning: false, label: 'Authored source', value: row.sourcePath, description: 'Current source may differ' });
		if (row.type === 'header') {
			const header = this.snapshot.header;
			this.properties.push(
				{ warning: false, label: 'Header', value: `${header.headerSize} bytes`, description: '' },
				{ warning: false, label: 'Manifest', value: `${formatNumberAsHex(header.manifestOffset, 8)} / ${header.manifestLength} bytes`, description: '' },
				{ warning: false, label: 'TOC', value: `${formatNumberAsHex(header.tocOffset, 8)} / ${header.tocLength} bytes`, description: `${this.snapshot.assets.length} entries` },
				{ warning: false, label: 'Metadata', value: `${formatNumberAsHex(header.metadataOffset, 8)} / ${header.metadataLength} bytes`, description: '' },
				{ warning: false, label: 'Data envelope', value: `${formatNumberAsHex(header.dataOffset, 8)} / ${header.dataLength} bytes`, description: 'Contains payload sections; not additional physical storage.' },
				{ warning: false, label: 'BLua32 image', value: `${formatNumberAsHex(header.blua32ImageOffset, 8)} / ${header.blua32ImageByteCount} bytes`, description: '' },
				{ warning: false, label: 'Startup function', value: formatNumberAsHex(header.blua32StartupFunctionAddress, 8), description: 'Mapped function-record address.' },
				{ warning: false, label: 'IRQ function', value: formatNumberAsHex(header.blua32IrqFunctionAddress, 8), description: 'Mapped function-record address.' },
				{ warning: false, label: 'Exception function', value: formatNumberAsHex(header.blua32ExceptionFunctionAddress, 8), description: 'Mapped function-record address.' },
				{ warning: false, label: 'Diagnostic directory', value: formatNumberAsHex(header.blua32DiagnosticDirectoryOffset, 8), description: 'Physical file offset.' },
			);
		}
		if (row.asset !== undefined) {
			const asset = row.asset;
			if (asset.imgmeta !== undefined) {
				const meta = asset.imgmeta;
				this.properties.push(
					{ warning: false, label: 'Image dimensions', value: `${meta.width} x ${meta.height}`, description: '' },
					{ warning: false, label: 'Texture coordinates', value: `${meta.texture_u}, ${meta.texture_v}`, description: '' },
				);
				if (meta.gx_atlas_id !== undefined) this.properties.push({ warning: false, label: 'Atlas', value: meta.gx_atlas_id, description: `${meta.gx_source_x}, ${meta.gx_source_y}` });
				if (meta.gx_page_tiles !== undefined) this.properties.push({ warning: false, label: 'Texture page tiles', value: String(meta.gx_page_tiles.length), description: '' });
			}
			if (asset.texturemeta !== undefined) {
				const meta = asset.texturemeta;
				this.properties.push(
					{ warning: false, label: 'Texture mode', value: String(meta.mode), description: '' },
					{ warning: false, label: 'Texture dimensions', value: `${meta.word_width} words x ${meta.height}`, description: '' },
					{ warning: false, label: 'Texture / CLUT words', value: `${meta.texture_word_count} / ${meta.clut_word_count}`, description: '' },
				);
			}
			if (asset.audiometa !== undefined) {
				const meta = asset.audiometa;
				this.properties.push({ warning: false, label: 'Audio type / priority', value: `${meta.audiotype} / ${meta.priority}`, description: '' });
				if (meta.loop !== undefined) this.properties.push({ warning: false, label: 'Loop start', value: String(meta.loop), description: '' });
				if (meta.loopEnd !== undefined) this.properties.push({ warning: false, label: 'Loop end', value: String(meta.loopEnd), description: '' });
			}
			if (asset.program_module !== undefined) this.properties.push({ warning: false, label: 'Program module', value: String(asset.program_module), description: '' });
			for (const range of romAssetRanges(row.asset)) this.properties.push({ warning: false, label: range.kind, value: `${formatNumberAsHex(range.start, 8)} .. ${formatNumberAsHex(range.end, 8)}`, description: `${range.end - range.start} bytes` });
			if (row.asset.op !== undefined) this.properties.push({ warning: false, label: 'TOC operation', value: row.asset.op, description: '' });
		}
		if (row.functionIndex !== undefined) {
			const fn = this.code!.layout.functions[row.functionIndex];
			this.properties.push({ warning: false, label: 'Function record / PC', value: `${formatNumberAsHex(fn.address, 8)} / ${formatNumberAsHex(fn.codeAddress, 8)}`, description: `${fn.numParams} parameters; ${fn.maxStack} registers; ${fn.upvalues.length} upvalues${fn.isVararg ? '; vararg' : ''}` });
			if (this.indexedFunction !== row.functionIndex) {
				this.instructions = indexBlua32FunctionInstructions(this.code!.layout, row.functionIndex);
				this.indexedFunction = row.functionIndex;
			}
		}
	}
}
