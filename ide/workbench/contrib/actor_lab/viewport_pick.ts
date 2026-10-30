import type { Table } from '../../../../machine/ts/machine/cpu/table';
import { valueTag, ValueTag } from '../../../../machine/ts/machine/cpu/value';
import { buildModuleExportSlotName } from '../../../../toolchain/ts/lua/module_path';
import type { ResourceDomain } from '../../../common/resource';
import type { Affine2 } from '../../../common/affine2';
import { CartlibSpatialReader2D } from '../../../runtime/cartlib_spatial';
import { readRuntimeLuaModuleExport } from '../../../runtime/lua_inspection';
import { Blua32GlobalRegisterFile, type RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { GuestInvalidationReason, SuspendedGuestSession, SuspendedValueIdentity } from '../../../runtime/suspended_guest';

const WORLD_EXPORT = buildModuleExportSlotName('cartlib/world/world', []);

export type ActorViewportHit = {
	domain: ResourceDomain; hashId: number; label: string;
	left: number; top: number; right: number; bottom: number;
};

/** Geometric picking from the retained draw lane, not colliders or a guest probe.
 * One scalar hit is reused; no guest reference survives a CPU slice. */
export class ActorViewportPicker {
	public readonly hit: ActorViewportHit = { domain: 0, hashId: 0, label: '', left: 0, top: 0, right: 0, bottom: 0 };
	private readonly spatial: CartlibSpatialReader2D;
	private readonly pose: Affine2 = { xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 };
	private domain: ResourceDomain | undefined;
	private media: RuntimeInstalledSourceState['currentBlua32Media'] | undefined;
	private bound = false;
	private worldRegisters: Blua32GlobalRegisterFile;
	private fullDraw: SuspendedValueIdentity;
	private regionDraw: SuspendedValueIdentity;
	private labelId: SuspendedValueIdentity;
	private labelDefinition: SuspendedValueIdentity;
	private labelHashId = 0;
	private revision = 0;
	private queriedRevision = -1;
	private x = 0;
	private y = 0;
	public constructor(private readonly sources: RuntimeInstalledSourceState, private readonly guest: SuspendedGuestSession) {
		this.spatial = new CartlibSpatialReader2D(guest);
	}
	public invalidate(reason: GuestInvalidationReason): void {
		this.spatial.end();
		this.revision++;
		if (reason !== 'execution') { this.media = undefined; this.hit.hashId = 0; this.labelHashId = 0; }
	}
	public pick(domain: ResourceDomain, x: number, y: number): ActorViewportHit | undefined {
		if (this.domain !== domain || this.media !== this.sources.currentBlua32Media) {
			this.domain = domain; this.media = this.sources.currentBlua32Media; this.bound = false;
			this.queriedRevision = -1; this.labelHashId = 0;
		}
		if (this.queriedRevision === this.revision && this.x === x && this.y === y) return this.hit.hashId === 0 ? undefined : this.hit;
		this.queriedRevision = this.revision; this.x = x; this.y = y; this.hit.hashId = 0;
		if (!this.bound) {
			const image = domain === -1 ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[domain];
			const registers = image?.globalRegisterFileByName.get(WORLD_EXPORT);
			if (registers === undefined) return;
			const sprite = readRuntimeLuaModuleExport(this.sources, this.guest, domain, 'cartlib/component/sprite_component');
			if (sprite.kind !== 'value' || sprite.value === null) return;
			this.fullDraw = this.guest.identity(this.guest.readStringMember(sprite.value, 'draw_visual'));
			this.regionDraw = this.guest.identity(this.guest.readStringMember(sprite.value, 'draw_region_visual'));
			this.worldRegisters = registers; this.bound = true;
		}
		const world = this.worldRegisters === Blua32GlobalRegisterFile.System ? this.guest.systemGlobal(WORLD_EXPORT) : this.guest.global(WORLD_EXPORT);
		if (valueTag(world) === ValueTag.Nil) return;
		const visuals = this.guest.readStringMember(world, '_render_visuals') as Table;
		const count = this.guest.readStringMember(world, '_render_visual_count') as number;
		this.spatial.begin();
		for (let index = count; index > 0; index--) {
			const visual = visuals.getInteger(index) as Table, owner = this.guest.readStringMember(visual, 'owner') as Table;
			if (!this.guest.isTruthy(this.guest.readStringMember(owner, 'visible')) || !this.guest.isTruthy(this.guest.readStringMember(visual, 'visible'))) continue;
			const draw = this.guest.readStringMember(visual, 'draw');
			const region = this.guest.matchesIdentity(draw, this.regionDraw);
			if (!region && !this.guest.matchesIdentity(draw, this.fullDraw)) continue;
			const pose = this.pose;
			this.spatial.readVisual(visual, pose);
			const width = this.guest.readStringMember(visual, region ? 'region_width' : 'source_width') as number;
			const height = this.guest.readStringMember(visual, region ? 'region_height' : 'source_height') as number;
			const determinant = pose.xx * pose.yy - pose.yx * pose.xy;
			// A singular planar image has no interior; it is not an inflated AABB.
			if (determinant === 0) continue;
			const dx = x - pose.ox, dy = y - pose.oy;
			const u = (pose.yy * dx - pose.yx * dy) / determinant;
			const v = (pose.xx * dy - pose.xy * dx) / determinant;
			if (!(u >= 0 && u < width && v >= 0 && v < height)) continue;
			const x0 = pose.ox, y0 = pose.oy;
			const ax = pose.xx * width, ay = pose.xy * width;
			const bx = pose.yx * height, by = pose.yy * height;
			const left = Math.min(x0, x0 + ax, x0 + bx, x0 + ax + bx);
			const right = Math.max(x0, x0 + ax, x0 + bx, x0 + ax + bx);
			const top = Math.min(y0, y0 + ay, y0 + by, y0 + ay + by);
			const bottom = Math.max(y0, y0 + ay, y0 + by, y0 + ay + by);
			const id = this.guest.readStringMember(owner, 'id'), definition = this.guest.readStringMember(owner, 'definition_id');
			if (this.labelHashId !== owner.hashId || !this.guest.matchesIdentity(id, this.labelId) || !this.guest.matchesIdentity(definition, this.labelDefinition)) {
				this.labelHashId = owner.hashId;
				this.labelId = this.guest.identity(id); this.labelDefinition = this.guest.identity(definition);
				const name = this.guest.formatValue(id);
				this.hit.label = valueTag(definition) === ValueTag.Nil ? valueTag(id) === ValueTag.Number ? `#${name}` : name
					: `${this.guest.formatValue(definition)} #${name}`;
			}
			this.hit.domain = domain; this.hit.hashId = owner.hashId;
			this.hit.left = left; this.hit.right = right;
			this.hit.top = top; this.hit.bottom = bottom;
			this.spatial.end();
			return this.hit;
		}
		this.spatial.end();
	}
}
