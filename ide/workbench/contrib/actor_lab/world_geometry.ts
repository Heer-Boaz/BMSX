import { asTable, isNil, numberToHost, ValueTag, type Value } from '../../../../machine/ts/machine/cpu/value';
import { luaFloorDivide } from '../../../../machine/ts/spec/blua32/numeric';
import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import type { Affine3 } from '../../../../machine/ts/common/affine3';
import type { Affine2 } from '../../../common/affine2';
import type { ResourceDomain } from '../../../common/resource';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { ActorRenderQuad, ActorVisualKind } from './render_geometry';

export type WorldActor = { domain: ResourceDomain; hashId: number; label: string };
export type WorldTexture = { readonly domain: ResourceDomain; readonly address: number | null; readonly bytes: number; readonly decodedWords: number;
	readonly mode: number; readonly wordWidth: number; readonly height: number };
type Image = { readonly texture: WorldTexture; readonly x: number; readonly y: number; readonly width: number; readonly height: number };
export type WorldPacket = { readonly image?: Image; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly color: number; readonly flipH: boolean; readonly flipV: boolean };
type GlyphRow = { readonly glyphs: readonly Image[]; readonly offsets: readonly number[]; readonly x: number; readonly y: number; readonly visible: number };
type Appearance = { readonly generation: number; readonly domain: ResourceDomain; readonly component: number; readonly revision: number; readonly source: number;
	readonly color: number; readonly background: number | null; readonly width: number; readonly height: number;
	readonly x: number; readonly y: number; readonly flipH: boolean; readonly flipV: boolean;
	readonly rows: readonly GlyphRow[]; readonly packets: readonly WorldPacket[] };
export type WorldCanvasVisual = { readonly actor: WorldActor; readonly pose: Affine2; appearance: Appearance | undefined };
export type WorldModelKey = { readonly domain: ResourceDomain; readonly id: string };
export type WorldModelVisual = { readonly entry: WorldActor; readonly world: Affine3; readonly attachment: Readonly<Affine3>; readonly presentation: Readonly<Affine3>;
	model: WorldModelKey; sceneIndex: number | undefined };
const IDENTITY: Readonly<Affine3> = { xx: 1, xy: 0, xz: 0, yx: 0, yy: 1, yz: 0, zx: 0, zy: 0, zz: 1, ox: 0, oy: 0, oz: 0 };

/** Preprojection evidence from completed standard cartlib draws. No borrowed Lua
 * table or camera-clipped primitive survives this boundary. Immutable appearance
 * packets are shared by submitted/latch/display frames, poses are copied. */
export class ActorWorldGeometry {
	private generation = 0;
	public invalidate(): void { this.generation++; this.clear(); }
	public readonly canvas = new ScratchBuffer<WorldCanvasVisual>(() => ({ actor: { domain: 0, hashId: 0, label: '' },
		pose: { xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 }, appearance: undefined }));
	public readonly models = new ScratchBuffer<WorldModelVisual>(() => ({ entry: { domain: 0, hashId: 0, label: '' },
		world: { ...IDENTITY }, attachment: IDENTITY, presentation: IDENTITY, model: { domain: 0, id: '' }, sceneIndex: undefined }));
	public clear(): void { this.canvas.clear(); this.models.clear(); }
	public copyFrom(source: ActorWorldGeometry): void {
		this.clear();
		for (let i = 0; i < source.canvas.length; i++) {
			const from = source.canvas.peek(i), to = this.canvas.get(i);
			Object.assign(to.actor, from.actor); Object.assign(to.pose, from.pose); to.appearance = from.appearance;
		}
		for (let i = 0; i < source.models.length; i++) {
			const from = source.models.peek(i), to = this.models.get(i);
			Object.assign(to.entry, from.entry); Object.assign(to.world, from.world); to.model = from.model; to.sceneIndex = from.sceneIndex;
		}
	}
	public captureCanvas(visual: Value, kind: Exclude<ActorVisualKind, 'models'>, actor: ActorRenderQuad, pose: Readonly<Affine2>, width: number, height: number, guest: SuspendedGuestSession): void {
		const item = this.canvas.get(this.canvas.length);
		Object.assign(item.pose, pose);
		item.actor.domain = actor.domain; item.actor.hashId = actor.hashId; item.actor.label = actor.label;
		const previous = item.appearance, old = previous?.generation === this.generation && previous.domain === actor.domain ? previous : undefined, color = numberToHost(guest.readStringMember(visual, 'color')) >>> 0;
		if (kind === 'text') { this.captureText(item, visual, color, guest); return; }
		if (kind === 'surface') { this.captureSurface(item, visual, color, guest); return; }
		const component = guest.identityScalar(visual, ValueTag.Table);
		const source = kind === 'rectangle' ? null : guest.readStringMember(visual, '_source');
		const x = kind === 'region' ? numberToHost(guest.readStringMember(visual, 'region_x')) : 0;
		const y = kind === 'region' ? numberToHost(guest.readStringMember(visual, 'region_y')) : 0;
		const flipH = kind !== 'rectangle' && guest.isTruthy(guest.readStringMember(visual, 'flip_h'));
		const flipV = kind !== 'rectangle' && guest.isTruthy(guest.readStringMember(visual, 'flip_v'));
		const hash = source === null ? 0 : guest.identityScalar(source, ValueTag.Table);
		if (old?.component === component && old.source === hash && old.color === color && old.width === width && old.height === height
			&& old.x === x && old.y === y && old.flipH === flipH && old.flipV === flipV) return;
		const image = source === null ? undefined : this.image(source, actor.domain, guest);
		item.appearance = { generation: this.generation, domain: item.actor.domain, component, source: hash, color, background: null, width, height, x, y, flipH, flipV, revision: 0, rows: [],
			packets: [{ image: image === undefined ? undefined : { ...image, x: image.x + x, y: image.y + y, width, height }, x: 0, y: 0, width, height, color, flipH, flipV }] };
	}
	private captureSurface(item: WorldCanvasVisual, visual: Value, color: number, guest: SuspendedGuestSession): void {
		const component = guest.identityScalar(visual, ValueTag.Table);
		const source = guest.readStringMember(visual, '_source'), sourceId = guest.identityScalar(source, ValueTag.Table), old = item.appearance;
		if (old?.generation === this.generation && old.domain === item.actor.domain && old.component === component && old.source === sourceId && old.color === color) return;
		const tiles = guest.readStringMember(source, '_tiles'), packets: WorldPacket[] = [];
		if (isNil(tiles)) {
			const image = this.image(source, item.actor.domain, guest);
			packets.push({ image, x: 0, y: 0, width: image.width, height: image.height, color, flipH: false, flipV: false });
		} else {
			const tileArray = asTable(tiles, guest.cpu.gc);
			for (let i = 1, length = tileArray.records.length(tileArray.address); i <= length; i++) {
				const tile = tileArray.records.getInteger(tileArray.address, i), image = this.image(tile, item.actor.domain, guest);
				packets.push({ image, x: numberToHost(guest.readStringMember(tile, 'offset_x')), y: numberToHost(guest.readStringMember(tile, 'offset_y')),
					width: image.width, height: image.height, color, flipH: false, flipV: false });
			}
		}
		item.appearance = { generation: this.generation, domain: item.actor.domain, component, source: sourceId, color, background: null,
			width: 0, height: 0, x: 0, y: 0, flipH: false, flipV: false, revision: 0, rows: [], packets };
	}
	private image(source: Value, domain: ResourceDomain, guest: SuspendedGuestSession): Image {
		const texture = guest.readStringMember(source, '_texture'), addressValue = guest.readStringMember(texture, 'source_addr');
		const address = isNil(addressValue) ? null : numberToHost(addressValue) >>> 0;
		return { texture: { domain, address, bytes: address === null ? 0 : numberToHost(guest.readStringMember(texture, 'stream_word_count')) * 4,
			decodedWords: address === null ? 0 : (numberToHost(guest.readStringMember(texture, 'texture_word_count')) + numberToHost(guest.readStringMember(texture, 'clut_word_count'))) >>> 0,
			mode: numberToHost(guest.readStringMember(texture, 'mode')),
			wordWidth: address === null ? 0 : numberToHost(guest.readStringMember(texture, 'word_width')),
			height: address === null ? 0 : numberToHost(guest.readStringMember(texture, 'height')) },
			x: numberToHost(guest.readStringMember(source, 'source_x')), y: numberToHost(guest.readStringMember(source, 'source_y')),
			width: numberToHost(guest.readStringMember(source, 'width')), height: numberToHost(guest.readStringMember(source, 'height')) };
	}
	private captureText(item: WorldCanvasVisual, visual: Value, color: number, guest: SuspendedGuestSession): void {
		const component = guest.identityScalar(visual, ValueTag.Table);
		const previous = item.appearance, old = previous?.generation === this.generation && previous.domain === item.actor.domain ? previous : undefined, revision = numberToHost(guest.readStringMember(visual, '_layout_revision'));
		const lines = asTable(guest.readStringMember(visual, 'glyph_lines'), guest.cpu.gc), count = numberToHost(guest.readStringMember(visual, 'glyph_line_count'));
		const backgroundValue = guest.readStringMember(visual, 'background_color');
		const background = isNil(backgroundValue) ? null : numberToHost(backgroundValue) >>> 0;
		const revealValue = guest.readStringMember(visual, 'glyph_visible_height');
		const reveal = isNil(revealValue) ? null : numberToHost(revealValue);
		const sameLayout = old?.component === component && old.revision === revision;
		let same = sameLayout && old.color === color && old.background === background;
		if (same) for (let i = 0; i < count; i++) if (old.rows[i].visible !== numberToHost(guest.readStringMember(lines.records.getInteger(lines.address, i + 1), 'visible_count'))) { same = false; break; }
		if (same) return;
		const offsetsValue = guest.readStringMember(visual, 'line_offsets');
		const offsets = isNil(offsetsValue) ? null : asTable(offsetsValue, guest.cpu.gc);
		const xOffsetsValue = guest.readStringMember(visual, 'line_x_offsets');
		const xOffsets = isNil(xOffsetsValue) ? null : asTable(xOffsetsValue, guest.cpu.gc);
		const centerValue = guest.readStringMember(visual, 'center_block_width');
		const center = isNil(centerValue) ? null : numberToHost(centerValue);
		const lineWidths = guest.readStringMember(visual, 'line_widths');
		const widths = asTable(isNil(lineWidths) ? guest.readStringMember(visual, 'layout_line_widths') : lineWidths, guest.cpu.gc);
		const lineHeight = numberToHost(guest.readStringMember(visual, 'line_height'));
		const rows: GlyphRow[] = [], packets: WorldPacket[] = [];
		for (let i = 0; i < count; i++) {
			const line = lines.records.getInteger(lines.address, i + 1), visible = numberToHost(guest.readStringMember(line, 'visible_count'));
			if (sameLayout) { rows.push({ ...old.rows[i], visible }); continue; }
			const glyphLine = asTable(line, guest.cpu.gc);
			const length = numberToHost(guest.readStringMember(line, 'glyph_count')), positions = asTable(guest.readStringMember(line, 'x_offsets'), guest.cpu.gc);
			const glyphs: Image[] = [], advances: number[] = [];
			for (let g = 1; g <= length; g++) { glyphs.push(this.image(glyphLine.records.getInteger(glyphLine.address, g), item.actor.domain, guest)); advances.push(numberToHost(positions.records.getInteger(positions.address, g))); }
			rows.push({ glyphs, offsets: advances, visible, x: xOffsets !== null ? numberToHost(xOffsets.records.getInteger(xOffsets.address, i + 1))
				: center === null ? 0 : luaFloorDivide(center - numberToHost(widths.records.getInteger(widths.address, i + 1)), 2), y: offsets === null ? i * lineHeight : numberToHost(offsets.records.getInteger(offsets.address, i + 1)) });
		}
		if (background !== null) for (const row of rows) for (let i = 0; i < row.visible; i++) {
			const image = row.glyphs[i]; packets.push({ x: row.x + row.offsets[i], y: row.y, width: image.width, height: image.height, color: background, flipH: false, flipV: false });
		}
		for (const row of rows) for (let i = 0; i < row.visible; i++) {
			const image = row.glyphs[i], height = reveal === null ? image.height : reveal;
			if (height !== 0) packets.push({ image: reveal === null ? image : { ...image, height }, x: row.x + row.offsets[i], y: row.y, width: image.width, height, color, flipH: false, flipV: false });
		}
		item.appearance = { generation: this.generation, domain: item.actor.domain, component, revision, source: 0, color, background, width: 0, height: 0, x: 0, y: 0, flipH: false, flipV: false, rows, packets };
	}
	public captureModels(renderer: Value, domain: ResourceDomain, guest: SuspendedGuestSession): void {
		const view = guest.readStringMember(renderer, '_models'), models = asTable(guest.readStringMember(view, 'components'), guest.cpu.gc);
		const count = models.records.length(models.address), visibility = asTable(guest.readStringMember(renderer, '_visible'), guest.cpu.gc);
		for (let i = 1; i <= count; i++) {
			if (!guest.isTruthy(visibility.records.getInteger(visibility.address, i))) continue;
			const model = models.records.getInteger(models.address, i), owner = guest.readStringMember(model, 'owner');
			const ownerId = guest.identityScalar(owner, ValueTag.Table);
			const item = this.models.get(this.models.length), actor = item.entry, world = item.world;
			if (actor.hashId !== ownerId || actor.domain !== domain) actor.label = guest.formatValue(guest.readStringMember(owner, 'id'));
			actor.domain = domain; actor.hashId = ownerId;
			const id = guest.stringText(guest.readStringMember(model, 'model_id'));
			if (item.model.domain !== domain || item.model.id !== id) item.model = { domain, id };
			const sceneValue = guest.readStringMember(model, 'scene_index');
			const scene = isNil(sceneValue) ? null : numberToHost(sceneValue);
			item.sceneIndex = scene === null ? undefined : scene;
			world.xx = numberToHost(guest.readStringMember(model, 'wxx')); world.xy = numberToHost(guest.readStringMember(model, 'wxy')); world.xz = numberToHost(guest.readStringMember(model, 'wxz'));
			world.yx = numberToHost(guest.readStringMember(model, 'wyx')); world.yy = numberToHost(guest.readStringMember(model, 'wyy')); world.yz = numberToHost(guest.readStringMember(model, 'wyz'));
			world.zx = numberToHost(guest.readStringMember(model, 'wzx')); world.zy = numberToHost(guest.readStringMember(model, 'wzy')); world.zz = numberToHost(guest.readStringMember(model, 'wzz'));
			world.ox = numberToHost(guest.readStringMember(model, 'wox')); world.oy = numberToHost(guest.readStringMember(model, 'woy')); world.oz = numberToHost(guest.readStringMember(model, 'woz'));
		}
	}
}
