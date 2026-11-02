import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { Affine2 } from '../../../common/affine2';
import { CartlibSpatialReader2D } from '../../../runtime/cartlib_spatial';
import { readRuntimeLuaModuleExport } from '../../../runtime/lua_inspection';
import type { RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession, SuspendedValueIdentity } from '../../../runtime/suspended_guest';
import type { RectBounds } from '../../../../machine/ts/common/rect';

export type ScenePreviewVisual = Affine2 & { memberIndex: number; left: number; top: number; right: number; bottom: number };
const DRAW_METHODS = [
	['cartlib/component/rectangle_component', 'draw_rectangle'],
	['cartlib/component/sprite_component', 'draw_visual'],
	['cartlib/component/sprite_component', 'draw_region_visual'],
	['cartlib/text/text_component', 'draw_visual'],
] as const;

/** Actual draw identities and retained geometry, captured alongside the rendered
 * image. Unknown draw functions remain visible but have no fabricated hit box. */
export class ScenePreviewGeometry {
	public readonly visuals: ScenePreviewVisual[] = [];
	public readonly represented = new Set<number>();
	public revision = 0;
	private readonly spatial: CartlibSpatialReader2D;
	private readonly methods: (SuspendedValueIdentity | undefined)[] = [];
	private readonly memberIndices = new Map<number, number>();
	private bound = false;
	public constructor(private readonly sources: RuntimeInstalledSourceState, private readonly guest: SuspendedGuestSession) {
		this.spatial = new CartlibSpatialReader2D(guest);
	}
	public capture(world: Table, sceneHashId: number): void {
		const guest = this.guest;
		if (!this.bound) {
			for (const [path, name] of DRAW_METHODS) {
				const module = readRuntimeLuaModuleExport(this.sources, guest, 0, path);
				this.methods.push(module.kind === 'value' && module.value !== null ? guest.identity(guest.readStringMember(module.value, name)) : undefined);
			}
			this.bound = true;
		}
		this.memberIndices.clear(); this.represented.clear();
		const objects = guest.readStringMember(world, '_objects') as Table;
		for (let index = 1; index <= objects.arrayLength; index++) {
			const scene = guest.readStringMember(objects.getInteger(index), 'scene') as Table | null;
			if (scene === null || scene.hashId !== sceneHashId) continue;
			const members = guest.readStringMember(scene, '_members_by_index') as Table;
			for (let memberIndex = 1; memberIndex <= members.arrayLength; memberIndex++) {
				const member = members.getInteger(memberIndex) as Table | null;
				if (member !== null) this.memberIndices.set(member.hashId, memberIndex);
			}
			break;
		}
		const lane = guest.readStringMember(world, '_render_visuals') as Table;
		const count = guest.readStringMember(world, '_render_visual_count') as number;
		let length = 0;
		this.spatial.begin();
		for (let index = 1; index <= count; index++) {
			const visual = lane.getInteger(index) as Table, owner = guest.readStringMember(visual, 'owner') as Table;
			const memberIndex = this.memberIndices.get(owner.hashId);
			if (memberIndex === undefined || !guest.isTruthy(guest.readStringMember(owner, 'visible')) || !guest.isTruthy(guest.readStringMember(visual, 'visible'))) continue;
			const draw = guest.readStringMember(visual, 'draw');
			let kind = -1;
			for (let method = 0; method < this.methods.length; method++) {
				const identity = this.methods[method];
				if (identity !== undefined && guest.matchesIdentity(draw, identity)) { kind = method; break; }
			}
			if (kind === -1) continue;
			this.represented.add(memberIndex);
			let target = this.visuals[length++];
			if (target === undefined) {
				target = { memberIndex, xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0, left: 0, top: 0, right: 0, bottom: 0 };
				this.visuals.push(target);
			}
			target.memberIndex = memberIndex;
			this.spatial.readVisual(visual, target);
			if (kind === 3) {
				target.left = guest.readStringMember(visual, '_layout_left') as number;
				target.top = guest.readStringMember(visual, '_layout_top') as number;
				target.right = guest.readStringMember(visual, '_layout_right') as number;
				target.bottom = guest.readStringMember(visual, '_layout_bottom') as number;
			} else {
				target.left = 0; target.top = 0;
				target.right = guest.readStringMember(visual, kind === 0 ? 'width' : kind === 1 ? 'source_width' : 'region_width') as number;
				target.bottom = guest.readStringMember(visual, kind === 0 ? 'height' : kind === 1 ? 'source_height' : 'region_height') as number;
			}
		}
		this.spatial.end(); this.visuals.length = length; this.revision++;
	}
	public pick(x: number, y: number): number | undefined {
		for (let index = this.visuals.length - 1; index >= 0; index--) {
			const pose = this.visuals[index], determinant = pose.xx * pose.yy - pose.xy * pose.yx;
			if (determinant === 0) continue;
			const dx = x - pose.ox, dy = y - pose.oy;
			const u = (pose.yy * dx - pose.yx * dy) / determinant, v = (pose.xx * dy - pose.xy * dx) / determinant;
			if (u >= pose.left && u < pose.right && v >= pose.top && v < pose.bottom) return pose.memberIndex;
		}
	}
	public frameBounds(memberIndex: number, bounds: RectBounds): boolean {
		bounds.left = Infinity; bounds.top = Infinity; bounds.right = -Infinity; bounds.bottom = -Infinity;
		for (const visual of this.visuals) {
			if (visual.memberIndex !== memberIndex) continue;
			for (let corner = 0; corner < 4; corner++) {
				const u = corner === 0 || corner === 3 ? visual.left : visual.right, v = corner < 2 ? visual.top : visual.bottom;
				const x = visual.ox + visual.xx * u + visual.yx * v, y = visual.oy + visual.xy * u + visual.yy * v;
				bounds.left = Math.min(bounds.left, x); bounds.top = Math.min(bounds.top, y);
				bounds.right = Math.max(bounds.right, x); bounds.bottom = Math.max(bounds.bottom, y);
			}
		}
		return this.represented.has(memberIndex);
	}
	public clear(): void { this.visuals.length = 0; this.memberIndices.clear(); this.represented.clear(); this.spatial.end(); }
}
