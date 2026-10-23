import { formatNumberAsHex } from '../../../../machine/ts/common/byte_hex_string';
import { HostBitmap } from '../../../../machine/ts/render/host_overlay/bitmap';
import { decodeRomAssetImage, type RomTextureDecodeCache } from '../../../../toolchain/ts/rompack/asset_image';
import { decodeCollisionShapeVariant, type CollisionShapeVariant } from '../../../../toolchain/ts/rompack/collision_shape_codec';
import { indexBlua32FunctionInstructions } from '../../../../toolchain/ts/rompack/disassembler';
import { WorkbenchImageViewport } from '../../ui/image_viewport';
import type { InspectedProperty } from '../../ui/property_inspector/model';
import type { RomInspectorByteRange, RomInspectorRow, RomInspectorSnapshot } from './model';

const NO_RANGES: readonly RomInspectorByteRange[] = [];
const NO_INSTRUCTIONS = new Uint32Array(0);
const NO_COLLISION_PATHS: readonly number[][] = [];
export type RomInspectorContentView = 'info' | 'preview' | 'bytes';

/** One exact snapshot subject, independent of the catalog cursor and reader attachment. */
export class RomInspectorContentModel {
	public subject: RomInspectorRow | undefined;
	public view: RomInspectorContentView = 'info';
	public revision = 0;
	public rangeRevision = 0;
	private readonly propertyRows: InspectedProperty[] = [];
	private propertiesRevision = -1;
	private instructionSubject: RomInspectorRow | undefined;
	private instructionAddresses: Uint32Array<ArrayBufferLike> = NO_INSTRUCTIONS;
	public preview: HostBitmap | undefined;
	public readonly imageView = new WorkbenchImageViewport();
	public showCollision = false;
	public collision: CollisionShapeVariant | undefined;
	public collisionPaths: readonly number[][] = NO_COLLISION_PATHS;
	private rangeIndex = 0;
	private readonly texture: RomTextureDecodeCache = {};

	public constructor(public readonly snapshot: RomInspectorSnapshot) {}
	public get ranges(): readonly RomInspectorByteRange[] { return this.subject?.ranges ?? NO_RANGES; }
	public get selectedRange(): RomInspectorByteRange | undefined { return this.ranges[this.rangeIndex]; }
	public get canPreviewImage(): boolean {
		const row = this.subject;
		return row?.kind === 'asset' && row.asset.op !== 'delete' && (row.asset.type === 'image' || row.asset.type === 'texture');
	}
	public get hasCollision(): boolean { return this.collision !== undefined; }

	public setSubject(row: RomInspectorRow | undefined): void {
		if (row === this.subject) return;
		this.preview?.dispose(); this.preview = undefined;
		this.collision = undefined; this.collisionPaths = NO_COLLISION_PATHS;
		this.subject = row; this.rangeIndex = 0;
		this.view = this.canPreviewImage ? 'preview' : row?.kind === 'function' ? 'bytes' : 'info';
		this.revision++; this.rangeRevision++;
	}

	public get instructions(): Uint32Array<ArrayBufferLike> {
		const row = this.subject;
		if (this.instructionSubject !== row) {
			this.instructionSubject = row;
			this.instructionAddresses = row?.kind === 'function' ? indexBlua32FunctionInstructions(row.image.layout, row.functionIndex) : NO_INSTRUCTIONS;
		}
		return this.instructionAddresses;
	}

	public get properties(): readonly InspectedProperty[] {
		if (this.propertiesRevision === this.rangeRevision) return this.propertyRows;
		this.propertiesRevision = this.rangeRevision;
		const row = this.subject;
		this.propertyRows.length = 0;
		if (row === undefined) return this.propertyRows;
		this.propertyRows.push({ warning: false, label: 'Name', value: row.label, description: row.type },
			{ warning: false, label: 'Stored bytes', value: `${row.byteLength} (${row.sizeText})`, description: row.kind === 'asset' ? 'Includes metadata' : '' });
		const range = this.selectedRange;
		if (range !== undefined) this.propertyRows.push({ warning: false, label: `Selected ${range.kind} range`, value: `${formatNumberAsHex(range.start, 8)} .. ${formatNumberAsHex(range.end, 8)}`, description: 'File offsets; end exclusive' });
		if (row.sourcePath !== undefined) this.propertyRows.push({ warning: false, label: 'Authored source', value: row.sourcePath, description: 'Current source may differ' });
		if (range?.kind === 'header') {
			const header = this.snapshot.header;
			this.propertyRows.push(
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
				this.propertyRows.push(
					{ warning: false, label: 'Image dimensions', value: `${meta.width} x ${meta.height}`, description: '' },
					{ warning: false, label: 'Texture coordinates', value: `${meta.texture_u}, ${meta.texture_v}`, description: '' },
				);
				if (meta.gx_atlas_id !== undefined) this.propertyRows.push({ warning: false, label: 'Atlas', value: meta.gx_atlas_id, description: `${meta.gx_source_x}, ${meta.gx_source_y}` });
				if (meta.gx_page_tiles !== undefined) this.propertyRows.push({ warning: false, label: 'Texture page tiles', value: String(meta.gx_page_tiles.length), description: '' });
			}
			if (asset.texturemeta !== undefined) {
				const meta = asset.texturemeta;
				this.propertyRows.push(
					{ warning: false, label: 'Texture mode', value: String(meta.mode), description: '' },
					{ warning: false, label: 'Texture dimensions', value: `${meta.word_width} words x ${meta.height}`, description: '' },
					{ warning: false, label: 'Texture / CLUT words', value: `${meta.texture_word_count} / ${meta.clut_word_count}`, description: '' },
				);
			}
			if (asset.audiometa !== undefined) {
				const meta = asset.audiometa;
				this.propertyRows.push({ warning: false, label: 'Audio type / priority', value: `${meta.audiotype} / ${meta.priority}`, description: '' });
				if (meta.loop !== undefined) this.propertyRows.push({ warning: false, label: 'Loop start', value: String(meta.loop), description: '' });
				if (meta.loopEnd !== undefined) this.propertyRows.push({ warning: false, label: 'Loop end', value: String(meta.loopEnd), description: '' });
			}
			if (asset.program_module !== undefined) this.propertyRows.push({ warning: false, label: 'Program module', value: String(asset.program_module), description: '' });
			if (row.kind === 'asset') for (const range of row.ranges) this.propertyRows.push({ warning: false, label: range.kind, value: `${formatNumberAsHex(range.start, 8)} .. ${formatNumberAsHex(range.end, 8)}`, description: `${range.end - range.start} bytes` });
			if (row.asset.op !== undefined) this.propertyRows.push({ warning: false, label: 'TOC operation', value: row.asset.op, description: '' });
		}
		if (row.kind === 'function') {
			const fn = row.image.layout.functions[row.functionIndex];
			this.propertyRows.push({ warning: false, label: 'Function record / PC', value: `${formatNumberAsHex(fn.address, 8)} / ${formatNumberAsHex(fn.codeAddress, 8)}`, description: `${fn.numParams} parameters; ${fn.maxStack} registers; ${fn.upvalues.length} upvalues${fn.isVararg ? '; vararg' : ''}` });
		}
		return this.propertyRows;
	}

	public setView(view: RomInspectorContentView): void {
		if (this.view === view) return;
		this.view = view; this.revision++;
	}

	public selectRange(index: number): void {
		if (this.rangeIndex !== index) {
			this.rangeIndex = index; this.rangeRevision++; this.revision++;
		}
		this.setView('bytes');
	}

	/** Only an expanded visible preview asks for pixels; other views retain the prepared resource. */
	public preparePreview(): void {
		if (this.preview !== undefined) return;
		const asset = this.subject!.asset!;
		const image = decodeRomAssetImage(this.snapshot.rom, this.snapshot.assets, asset, this.texture);
		this.preview = new HostBitmap({ width: image.width, height: image.height, pixels: image.rgba });
		this.imageView.setImage(image.width, image.height);
		if (asset.collision_bin_start !== undefined) {
			this.collision = decodeCollisionShapeVariant(this.snapshot.rom.subarray(asset.collision_bin_start, asset.collision_bin_end));
			const pieces = this.collision.pieces;
			if (pieces !== undefined) this.collisionPaths = pieces.map(piece => {
				if (piece.kind === 'convex_poly') return piece.vertices.concat(piece.vertices[0], piece.vertices[1]);
				const { left, top, right, bottom } = piece.bounds;
				return [left, top, right, top, right, bottom, left, bottom, left, top];
			});
		}
		this.revision++;
	}

	public dispose(): void {
		this.preview?.dispose(); this.preview = undefined;
		this.texture.current = undefined;
	}
}
