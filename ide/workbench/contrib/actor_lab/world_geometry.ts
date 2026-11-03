import { luaFloorDivide } from '../../../../machine/ts/spec/blua32/numeric';
import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import type { Affine3 } from '../../../../machine/ts/common/affine3';
import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { StringValue } from '../../../../machine/ts/machine/cpu/value';
import type { Affine2 } from '../../../common/affine2';
import type { ResourceDomain } from '../../../common/resource';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { ActorRenderQuad, ActorVisualKind } from './render_geometry';

export type WorldActor = { domain: ResourceDomain; hashId: number; label: string };
export type WorldTexture = { readonly domain: ResourceDomain; readonly address: number | null; readonly bytes: number;
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
	public captureCanvas(visual: Table, kind: Exclude<ActorVisualKind, 'models'>, actor: ActorRenderQuad, pose: Readonly<Affine2>, width: number, height: number, guest: SuspendedGuestSession): void {
		const item = this.canvas.get(this.canvas.length);
		Object.assign(item.pose, pose);
		item.actor.domain = actor.domain; item.actor.hashId = actor.hashId; item.actor.label = actor.label;
		const previous = item.appearance, old = previous?.generation === this.generation && previous.domain === actor.domain ? previous : undefined, color = guest.readStringMember(visual, 'color') as number;
		if (kind === 'text') { this.captureText(item, visual, color, guest); return; }
		if (kind === 'surface') { this.captureSurface(item, visual, color, guest); return; }
		const source = kind === 'rectangle' ? null : guest.readStringMember(visual, '_source') as Table;
		const x = kind === 'region' ? guest.readStringMember(visual, 'region_x') as number : 0;
		const y = kind === 'region' ? guest.readStringMember(visual, 'region_y') as number : 0;
		const flipH = kind !== 'rectangle' && guest.isTruthy(guest.readStringMember(visual, 'flip_h'));
		const flipV = kind !== 'rectangle' && guest.isTruthy(guest.readStringMember(visual, 'flip_v'));
		const hash = source === null ? 0 : source.hashId;
		if (old?.component === visual.hashId && old.source === hash && old.color === color && old.width === width && old.height === height
			&& old.x === x && old.y === y && old.flipH === flipH && old.flipV === flipV) return;
		const image = source === null ? undefined : this.image(source, actor.domain, guest);
		item.appearance = { generation: this.generation, domain: item.actor.domain, component: visual.hashId, source: hash, color, background: null, width, height, x, y, flipH, flipV, revision: 0, rows: [],
			packets: [{ image: image === undefined ? undefined : { ...image, x: image.x + x, y: image.y + y, width, height }, x: 0, y: 0, width, height, color, flipH, flipV }] };
	}
	private captureSurface(item: WorldCanvasVisual, visual: Table, color: number, guest: SuspendedGuestSession): void {
		const source = guest.readStringMember(visual, '_source') as Table, old = item.appearance;
		if (old?.generation === this.generation && old.domain === item.actor.domain && old.component === visual.hashId && old.source === source.hashId && old.color === color) return;
		const tiles = guest.readStringMember(source, '_tiles') as Table | null, packets: WorldPacket[] = [];
		if (tiles === null) {
			const image = this.image(source, item.actor.domain, guest);
			packets.push({ image, x: 0, y: 0, width: image.width, height: image.height, color, flipH: false, flipV: false });
		} else for (let i = 1; i <= tiles.arrayLength; i++) {
			const tile = tiles.get(i) as Table, image = this.image(tile, item.actor.domain, guest);
			packets.push({ image, x: guest.readStringMember(tile, 'offset_x') as number, y: guest.readStringMember(tile, 'offset_y') as number,
				width: image.width, height: image.height, color, flipH: false, flipV: false });
		}
		item.appearance = { generation: this.generation, domain: item.actor.domain, component: visual.hashId, source: source.hashId, color, background: null,
			width: 0, height: 0, x: 0, y: 0, flipH: false, flipV: false, revision: 0, rows: [], packets };
	}
	private image(source: Table, domain: ResourceDomain, guest: SuspendedGuestSession): Image {
		const texture = guest.readStringMember(source, '_texture') as Table, address = guest.readStringMember(texture, 'source_addr') as number | null;
		return { texture: { domain, address, bytes: address === null ? 0 : (guest.readStringMember(texture, 'stream_word_count') as number) * 4,
			mode: guest.readStringMember(texture, 'mode') as number,
			wordWidth: address === null ? 0 : guest.readStringMember(texture, 'word_width') as number,
			height: address === null ? 0 : guest.readStringMember(texture, 'height') as number },
			x: guest.readStringMember(source, 'source_x') as number, y: guest.readStringMember(source, 'source_y') as number,
			width: guest.readStringMember(source, 'width') as number, height: guest.readStringMember(source, 'height') as number };
	}
	private captureText(item: WorldCanvasVisual, visual: Table, color: number, guest: SuspendedGuestSession): void {
		const previous = item.appearance, old = previous?.generation === this.generation && previous.domain === item.actor.domain ? previous : undefined, revision = guest.readStringMember(visual, '_layout_revision') as number;
		const lines = guest.readStringMember(visual, 'glyph_lines') as Table, count = guest.readStringMember(visual, 'glyph_line_count') as number;
		const background = guest.readStringMember(visual, 'background_color') as number | null;
		const reveal = guest.readStringMember(visual, 'glyph_visible_height') as number | null;
		const sameLayout = old?.component === visual.hashId && old.revision === revision;
		let same = sameLayout && old.color === color && old.background === background;
		if (same) for (let i = 0; i < count; i++) if (old.rows[i].visible !== guest.readStringMember(lines.get(i + 1), 'visible_count')) { same = false; break; }
		if (same) return;
		const offsets = guest.readStringMember(visual, 'line_offsets') as Table | null;
		const xOffsets = guest.readStringMember(visual, 'line_x_offsets') as Table | null;
		const center = guest.readStringMember(visual, 'center_block_width') as number | null;
		const widths = (guest.readStringMember(visual, 'line_widths') ?? guest.readStringMember(visual, 'layout_line_widths')) as Table;
		const lineHeight = guest.readStringMember(visual, 'line_height') as number;
		const rows: GlyphRow[] = [], packets: WorldPacket[] = [];
		for (let i = 0; i < count; i++) {
			const line = lines.get(i + 1) as Table, visible = guest.readStringMember(line, 'visible_count') as number;
			if (sameLayout) { rows.push({ ...old.rows[i], visible }); continue; }
			const length = guest.readStringMember(line, 'glyph_count') as number, positions = guest.readStringMember(line, 'x_offsets') as Table;
			const glyphs: Image[] = [], advances: number[] = [];
			for (let g = 1; g <= length; g++) { glyphs.push(this.image(line.get(g) as Table, item.actor.domain, guest)); advances.push(positions.get(g) as number); }
			rows.push({ glyphs, offsets: advances, visible, x: xOffsets !== null ? xOffsets.get(i + 1) as number
				: center === null ? 0 : luaFloorDivide(center - (widths.get(i + 1) as number), 2), y: offsets === null ? i * lineHeight : offsets.get(i + 1) as number });
		}
		if (background !== null) for (const row of rows) for (let i = 0; i < row.visible; i++) {
			const image = row.glyphs[i]; packets.push({ x: row.x + row.offsets[i], y: row.y, width: image.width, height: image.height, color: background, flipH: false, flipV: false });
		}
		for (const row of rows) for (let i = 0; i < row.visible; i++) {
			const image = row.glyphs[i], height = reveal === null ? image.height : reveal;
			if (height !== 0) packets.push({ image: reveal === null ? image : { ...image, height }, x: row.x + row.offsets[i], y: row.y, width: image.width, height, color, flipH: false, flipV: false });
		}
		item.appearance = { generation: this.generation, domain: item.actor.domain, component: visual.hashId, revision, source: 0, color, background, width: 0, height: 0, x: 0, y: 0, flipH: false, flipV: false, rows, packets };
	}
	public captureModels(renderer: Table, domain: ResourceDomain, guest: SuspendedGuestSession): void {
		const view = guest.readStringMember(renderer, '_models') as Table, models = guest.readStringMember(view, 'components') as Table;
		const count = models.arrayLength, visibility = guest.readStringMember(renderer, '_visible') as Table;
		for (let i = 1; i <= count; i++) {
			if (!guest.isTruthy(visibility.get(i))) continue;
			const model = models.get(i) as Table, owner = guest.readStringMember(model, 'owner') as Table;
			const item = this.models.get(this.models.length), actor = item.entry, world = item.world;
			if (actor.hashId !== owner.hashId || actor.domain !== domain) actor.label = guest.formatValue(guest.readStringMember(owner, 'id'));
			actor.domain = domain; actor.hashId = owner.hashId;
			const id = guest.stringText(guest.readStringMember(model, 'model_id') as StringValue);
			if (item.model.domain !== domain || item.model.id !== id) item.model = { domain, id };
			const scene = guest.readStringMember(model, 'scene_index') as number | null;
			item.sceneIndex = scene === null ? undefined : scene;
			world.xx = guest.readStringMember(model, 'wxx') as number; world.xy = guest.readStringMember(model, 'wxy') as number; world.xz = guest.readStringMember(model, 'wxz') as number;
			world.yx = guest.readStringMember(model, 'wyx') as number; world.yy = guest.readStringMember(model, 'wyy') as number; world.yz = guest.readStringMember(model, 'wyz') as number;
			world.zx = guest.readStringMember(model, 'wzx') as number; world.zy = guest.readStringMember(model, 'wzy') as number; world.zz = guest.readStringMember(model, 'wzz') as number;
			world.ox = guest.readStringMember(model, 'wox') as number; world.oy = guest.readStringMember(model, 'woy') as number; world.oz = guest.readStringMember(model, 'woz') as number;
		}
	}
}
