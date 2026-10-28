import { formatByteSize, formatNumberAsHex } from '../../../../machine/ts/common/byte_hex_string';
import type { CartRomHeader } from '../../../../machine/ts/rompack/format';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../../../machine/ts/spec/bmsx/memory_map';
import type { PackedRomAsset, RomAsset } from '../../../../toolchain/ts/rompack/assets';
import { loadBlua32ToolingImage, type Blua32ToolingImage } from '../../../../toolchain/ts/rompack/blua32_media';
import { inspectRom, romAssetByteLength, romAssetRanges, type RomAssetRangeKind, type RomInspectionSection } from '../../../../toolchain/ts/rompack/inspection';
import type { ResourceDomain } from '../../../common/resource';
import { ROM_CATEGORIES, romAssetCategory, romInspectionSectionCategory, type RomInspectionCategory } from './colors';

export type RomInspectorSnapshot = {
	readonly domain: ResourceDomain;
	readonly sourceContextId: string;
	readonly label: string;
	readonly rom: Uint8Array;
	readonly header: CartRomHeader;
	readonly assets: readonly PackedRomAsset[];
};
const ENTRY_ORDER = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const NO_RANGES: readonly RomInspectorByteRange[] = [];

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
type RomInspectorRowFacts = {
	readonly category: RomInspectionCategory;
	readonly label: string;
	readonly type: string;
	readonly byteLength: number;
	readonly start: number | undefined;
	readonly end: number | undefined;
	readonly ranges: readonly RomInspectorByteRange[];
	readonly asset?: RomAsset;
	readonly functionIndex?: number;
	readonly image?: Blua32ToolingImage;
	readonly searchText: string;
	readonly sizeText: string;
};
export type RomInspectorFunctionRow = RomInspectorRowFacts & {
	readonly kind: 'function';
	readonly image: Blua32ToolingImage;
	readonly functionIndex: number;
	readonly sourceModule?: string;
};
export type RomInspectorRow = RomInspectorRowFacts & (
	| { readonly kind: 'asset'; readonly asset: RomAsset; readonly sourcePath?: string }
	| { readonly kind: 'section'; readonly sourcePath?: string }
) | RomInspectorFunctionRow;

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
	public functions: readonly RomInspectorFunctionRow[] = [];
	private selectedRow: RomInspectorRow | undefined;

	public constructor(public readonly snapshot: RomInspectorSnapshot) {
		this.inspection = inspectRom(snapshot.rom, snapshot.header, snapshot.assets);
		this.assets = snapshot.assets.map(asset => {
			const ranges = asset.op === 'delete' ? NO_RANGES : romAssetRanges(asset), first = ranges[0];
			const byteLength = romAssetByteLength(asset), sourcePath = asset.source_path, category = romAssetCategory(asset);
			return { kind: 'asset', label: asset.resid, type: asset.type, category, byteLength, start: first?.start, end: first?.end, ranges, asset, sourcePath,
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
		return { kind: 'section', label, type: category.id, category, byteLength, start: section.start, end: section.end,
			ranges: [{ kind: section.buffer ?? section.kind, start: section.start, end: section.end }], asset: section.asset,
			sourcePath: section.asset?.source_path, searchText: `${label} ${category.id} ${category.label} ${section.kind}`.toLowerCase(), sizeText: formatByteSize(byteLength) };
	}
	public get selection(): RomInspectorRow | undefined { return this.selectedRow; }
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
		this.functions = code.layout.functions.map<RomInspectorFunctionRow>((fn, functionIndex) => {
			const label = code.symbols === null ? formatNumberAsHex(fn.address, 8) : code.symbols.metadata.functionIds[functionIndex];
			const sourceModule = code.symbols === null ? undefined : code.symbols.metadata.functionDefinitions[functionIndex]?.path;
			return { kind: 'function', image: code, label, type: 'function', category: ROM_CATEGORIES.blua32, byteLength: fn.codeByteCount, start: fn.codeAddress - base, end: fn.codeAddress + fn.codeByteCount - base,
				ranges: [{ kind: 'instructions', start: fn.codeAddress - base, end: fn.codeAddress + fn.codeByteCount - base }],
				functionIndex, sourceModule, searchText: `${label} ${sourceModule ?? ''}`.toLowerCase(), sizeText: formatByteSize(fn.codeByteCount) };
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
		this.selectedRow = this.rows[index];
		this.revision++;
	}
}
