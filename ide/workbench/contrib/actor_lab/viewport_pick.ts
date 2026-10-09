import type { Table } from '../../../../machine/ts/machine/cpu/table';
import { valueTag, ValueTag } from '../../../../machine/ts/machine/cpu/value';
import { buildModuleExportSlotName } from '../../../../toolchain/ts/lua/module_path';
import type { ResourceDomain } from '../../../common/resource';
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
	public constructor(private readonly sources: RuntimeInstalledSourceState, private readonly guest: SuspendedGuestSession) {}
	public invalidate(reason: GuestInvalidationReason): void {
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
		for (let index = count; index > 0; index--) {
			const visual = visuals.getInteger(index), parent = this.guest.readStringMember(visual, 'parent') as Table;
			if (!this.guest.isTruthy(this.guest.readStringMember(parent, 'visible')) || !this.guest.isTruthy(this.guest.readStringMember(visual, 'visible'))) continue;
			const draw = this.guest.readStringMember(visual, 'draw');
			const region = this.guest.matchesIdentity(draw, this.regionDraw);
			if (!region && !this.guest.matchesIdentity(draw, this.fullDraw)) continue;
			const x0 = (this.guest.readStringMember(parent, 'x') as number) + (this.guest.readStringMember(visual, 'offset_x') as number)
				+ (this.guest.readStringMember(visual, 'draw_offset_x') as number);
			const y0 = (this.guest.readStringMember(parent, 'y') as number) + (this.guest.readStringMember(visual, 'offset_y') as number)
				+ (this.guest.readStringMember(visual, 'draw_offset_y') as number);
			const scaleX = (this.guest.readStringMember(visual, 'scale_x') as number) * (this.guest.readStringMember(visual, 'draw_scale_x') as number);
			const scaleY = (this.guest.readStringMember(visual, 'scale_y') as number) * (this.guest.readStringMember(visual, 'draw_scale_y') as number);
			const x1 = x0 + (this.guest.readStringMember(visual, region ? 'region_width' : 'source_width') as number) * scaleX;
			const y1 = y0 + (this.guest.readStringMember(visual, region ? 'region_height' : 'source_height') as number) * scaleY;
			const left = Math.min(x0, x1), right = Math.max(x0, x1), top = Math.min(y0, y1), bottom = Math.max(y0, y1);
			if (!(x >= left && x < right && y >= top && y < bottom)) continue;
			const id = this.guest.readStringMember(parent, 'id'), definition = this.guest.readStringMember(parent, 'definition_id');
			if (this.labelHashId !== parent.hashId || !this.guest.matchesIdentity(id, this.labelId) || !this.guest.matchesIdentity(definition, this.labelDefinition)) {
				this.labelHashId = parent.hashId;
				this.labelId = this.guest.identity(id); this.labelDefinition = this.guest.identity(definition);
				const name = this.guest.formatValue(id);
				this.hit.label = valueTag(definition) === ValueTag.Nil ? valueTag(id) === ValueTag.Number ? `#${name}` : name
					: `${this.guest.formatValue(definition)} #${name}`;
			}
			this.hit.domain = domain; this.hit.hashId = parent.hashId;
			this.hit.left = left; this.hit.right = right;
			this.hit.top = top; this.hit.bottom = bottom;
			return this.hit;
		}
	}
}
