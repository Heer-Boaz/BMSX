import { formatByteSize, formatNumberAsHex } from '../../../../machine/ts/common/byte_hex_string';
import type { CartRomHeader } from '../../../../machine/ts/rompack/format';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../../../machine/ts/spec/bmsx/memory_map';
import type { PackedRomAsset, RomAsset } from '../../../../toolchain/ts/rompack/assets';
import { loadBlua32ToolingImage, type Blua32ToolingImage } from '../../../../toolchain/ts/rompack/blua32_media';
import { blua32SourceRangeAtPc } from '../../../../toolchain/ts/rompack/blua32_symbols';
import { indexBlua32FunctionInstructions } from '../../../../toolchain/ts/rompack/disassembler';
import { inspectRom, romAssetByteLength, romAssetRanges, type RomAssetRangeKind, type RomInspectionSection } from '../../../../toolchain/ts/rompack/inspection';
import type { ResourceDomain } from '../../../common/resource';
import type { InspectedProperty } from '../../ui/property_inspector/model';
import { ROM_CATEGORIES, romAssetCategory, romInspectionSectionCategory, type RomInspectionCategory } from './colors';

export type RomInspectorSnapshot = {
	readonly domain: ResourceDomain;
	readonly label: string;
	readonly rom: Uint8Array;
	readonly header: CartRomHeader;
	readonly assets: readonly PackedRomAsset[];
};
const ENTRY_ORDER = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const NO_RANGES: readonly RomInspectorByteRange[] = [];
const NO_INSTRUCTIONS = new Uint32Array(0);

export type RomInspectorMode = 'assets' | 'structure' | 'code';
export type RomInspectorSort = 'name' | 'type' | 'size' | 'offset';
export type RomInspectorByteRange = {
	readonly kind: RomAssetRangeKind | RomInspectionSection['kind'] | 'instructions';
	readonly start: number;
	readonly end: number;
};
export type RomInspectorKeyEntry = {
	readonly category: RomInspectionCategory;
	readonly byteLength: number;
	readonly sizeText: string;
};
export type RomInspectorRow = {
	readonly category: RomInspectionCategory;
	readonly label: string;
	readonly type: string;
	readonly byteLength: number;
	readonly start: number | undefined;
	readonly end: number | undefined;
	readonly ranges: readonly RomInspectorByteRange[];
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
	public readonly keyEntries: readonly RomInspectorKeyEntry[];
	public readonly rows: RomInspectorRow[] = [];
	public mode: RomInspectorMode = 'assets';
	public filter = '';
	public sort: RomInspectorSort = 'name';
	public descending = false;
	public selected = -1;
	public revision = 0;
	public code: Blua32ToolingImage | null | undefined;
	public functions: readonly RomInspectorRow[] = [];
	public instructions: Uint32Array<ArrayBufferLike> = NO_INSTRUCTIONS;
	public readonly properties: InspectedProperty[] = [];
	private indexedFunction = -1;
	private selectedRow: RomInspectorRow | undefined;
	private rangeIndex = 0;

	public constructor(public readonly snapshot: RomInspectorSnapshot) {
		this.inspection = inspectRom(snapshot.rom, snapshot.header, snapshot.assets);
		this.assets = snapshot.assets.map(asset => {
			const ranges = asset.op === 'delete' ? NO_RANGES : romAssetRanges(asset), first = ranges[0];
			const byteLength = romAssetByteLength(asset), sourcePath = asset.source_path, category = romAssetCategory(asset);
			return { label: asset.resid, type: asset.type, category, byteLength, start: first?.start, end: first?.end, ranges, asset, sourcePath,
				searchText: `${asset.resid} ${asset.type} ${category.label} ${sourcePath ?? ''}`.toLowerCase(), sizeText: formatByteSize(byteLength) };
		});
		this.sections = this.inspection.sections.map(section => this.sectionRow(section));
		const entries: { category: RomInspectionCategory; byteLength: number; sizeText: string }[] = [];
		const byCategory = new Map<RomInspectionCategory, typeof entries[number]>();
		for (const row of this.sections) {
			if (row.byteLength === 0) continue;
			let entry = byCategory.get(row.category);
			if (entry === undefined) {
				entry = { category: row.category, byteLength: 0, sizeText: '' };
				byCategory.set(row.category, entry); entries.push(entry);
			}
			entry.byteLength += row.byteLength;
		}
		entries.sort((left, right) => right.byteLength - left.byteLength || ENTRY_ORDER.compare(left.category.label, right.category.label));
		for (const entry of entries) entry.sizeText = formatByteSize(entry.byteLength);
		this.keyEntries = entries;
		this.project();
	}
	private sectionRow(section: RomInspectionSection): RomInspectorRow {
		const label = section.asset === undefined ? section.kind : `${section.asset.resid} / ${section.buffer}`;
		const byteLength = section.end - section.start, category = romInspectionSectionCategory(section);
		return { label, type: category.id, category, byteLength, start: section.start, end: section.end,
			ranges: [{ kind: section.buffer ?? section.kind, start: section.start, end: section.end }], asset: section.asset,
			sourcePath: section.asset?.source_path, searchText: `${label} ${category.id} ${category.label} ${section.kind}`.toLowerCase(), sizeText: formatByteSize(byteLength) };
	}
	public get selection(): RomInspectorRow | undefined { return this.selectedRow; }
	public get ranges(): readonly RomInspectorByteRange[] { return this.selectedRow?.ranges ?? NO_RANGES; }
	public get selectedRange(): RomInspectorByteRange | undefined { return this.ranges[this.rangeIndex]; }
	public get canPreviewImage(): boolean {
		const asset = this.selectedRow?.asset;
		return this.mode === 'assets' && asset !== undefined && asset.op !== 'delete' && (asset.type === 'image' || asset.type === 'texture');
	}
	public selectRange(index: number): void {
		if (this.rangeIndex === index) return;
		this.rangeIndex = index;
		this.select(this.selected);
	}
	public setMode(mode: RomInspectorMode): void {
		if (this.mode === mode) return;
		this.mode = mode;
		if (mode === 'code' && this.code === undefined) this.loadCode();
		this.selected = -1;
		this.selectedRow = undefined;
		this.project();
	}
	private loadCode(): void {
		const snapshot = this.snapshot;
		this.code = loadBlua32ToolingImage({ bytes: snapshot.rom, header: snapshot.header }, snapshot.domain === -1 ? SYSTEM_ROM_BASE : CART_ROM_BASE, snapshot.assets);
		if (this.code === null) return;
		const code = this.code;
		const base = snapshot.domain === -1 ? SYSTEM_ROM_BASE : CART_ROM_BASE;
		this.functions = code.layout.functions.map<RomInspectorRow>((fn, functionIndex) => {
			const label = code.symbols === null ? formatNumberAsHex(fn.address, 8) : code.symbols.metadata.functionIds[functionIndex];
			const sourcePath = code.symbols === null ? undefined : blua32SourceRangeAtPc(code.symbols, code.layout.header.textAddress, fn.codeAddress)?.path;
			return { label, type: 'function', category: ROM_CATEGORIES.blua32, byteLength: fn.codeByteCount, start: fn.codeAddress - base, end: fn.codeAddress + fn.codeByteCount - base,
				ranges: [{ kind: 'instructions', start: fn.codeAddress - base, end: fn.codeAddress + fn.codeByteCount - base }],
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
		const row = this.rows[index];
		if (row !== this.selectedRow) this.rangeIndex = 0;
		this.selectedRow = row;
		this.revision += 1;
		this.properties.length = 0;
		if (row?.functionIndex === undefined) {
			this.instructions = NO_INSTRUCTIONS;
			this.indexedFunction = -1;
		}
		if (row === undefined) return;
		this.properties.push({ warning: false, label: 'Name', value: row.label, description: row.type },
			{ warning: false, label: 'Stored bytes', value: `${row.byteLength} (${row.sizeText})`, description: this.mode === 'assets' ? 'Includes metadata' : '' });
		const range = this.selectedRange;
		if (range !== undefined) this.properties.push({ warning: false, label: `Selected ${range.kind} range`, value: `${formatNumberAsHex(range.start, 8)} .. ${formatNumberAsHex(range.end, 8)}`, description: 'File offsets; end exclusive' });
		if (row.sourcePath !== undefined) this.properties.push({ warning: false, label: 'Authored source', value: row.sourcePath, description: 'Current source may differ' });
		if (range?.kind === 'header') {
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
			if (this.mode === 'assets') for (const range of row.ranges) this.properties.push({ warning: false, label: range.kind, value: `${formatNumberAsHex(range.start, 8)} .. ${formatNumberAsHex(range.end, 8)}`, description: `${range.end - range.start} bytes` });
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
