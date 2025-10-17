import { Collider2DComponent } from '../component/collisioncomponents';
import { WorldObject } from '../core/object/worldobject';
import { new_vec3 } from '../utils/utils';
import { $ } from '../core/game';
import { Collision2DSystem } from '../service/collision2d_service';
import type { Area, Polygon } from '../rompack/rompack';

type ColliderShape =
	| { kind: 'circle'; radius: number }
	| { kind: 'box'; width: number; height: number }
	| { kind: 'custom'; width: number; height: number };

export type ColliderCreateOptions = ColliderShape & {
	layer?: number;
	mask?: number;
	isTrigger?: boolean;
};

export type ColliderContactInfo = {
	normalX: number;
	normalY: number;
	depth: number | null;
};


class ConsoleColliderObject extends WorldObject {
	private readonly component: Collider2DComponent;
	private shape: ColliderShape;
	private width: number;
	private height: number;

	constructor(id: string, opts: ColliderCreateOptions) {
		super({ id });
		this.component = new Collider2DComponent({ parentid: this.id, id_local: 'console_collider' });
		this.component.layer = opts.layer ?? 1;
		this.component.mask = opts.mask ?? 0xFFFFFFFF;
		this.component.isTrigger = opts.isTrigger ?? false;
		this.component.generateOverlapEvents = false;
		this.addComponent(this.component);
		this.applyOptions(opts);
	}

	public applyOptions(opts: ColliderCreateOptions): void {
		this.shape = this.cloneShape(opts);
		this.component.layer = opts.layer ?? this.component.layer;
		this.component.mask = opts.mask ?? this.component.mask;
		this.component.isTrigger = opts.isTrigger ?? this.component.isTrigger;
		this.configureShape();
	}

	private cloneShape(opts: ColliderCreateOptions): ColliderShape {
		if (opts.kind === 'circle') {
			if (!(opts.radius > 0)) {
				throw new Error('[ConsoleColliders] Circular collider requires a positive radius.');
			}
			return { kind: 'circle', radius: opts.radius };
		}
		if (!(opts.width > 0) || !(opts.height > 0)) {
			throw new Error('[ConsoleColliders] Box collider requires positive width and height.');
		}
		if (opts.kind === 'custom') {
			return { kind: 'custom', width: opts.width, height: opts.height };
		}
		return { kind: 'box', width: opts.width, height: opts.height };
	}

	private configureShape(): void {
		if (this.shape.kind === 'circle') {
			const diameter = this.shape.radius * 2;
			this.width = diameter;
			this.height = diameter;
			this.sx = diameter;
			this.sy = diameter;
			this.component.setLocalArea({
				start: { x: 0, y: 0 },
				end: { x: diameter, y: diameter },
			});
			this.component.setLocalCircle({ x: this.shape.radius, y: this.shape.radius, r: this.shape.radius });
			this.component.setLocalPolygons(null);
			return;
		}
		this.width = this.shape.width;
		this.height = this.shape.height;
		this.sx = this.shape.width;
		this.sy = this.shape.height;
		this.component.setLocalArea({
			start: { x: 0, y: 0 },
			end: { x: this.shape.width, y: this.shape.height },
		});
		this.component.setLocalCircle(null);
		this.component.setLocalPolygons(null);
	}

	public setPosition(centerX: number, centerY: number): void {
		this.pos.x = centerX - this.width / 2;
		this.pos.y = centerY - this.height / 2;
	}

	public getCollider(): Collider2DComponent {
		return this.component;
	}

	public getWorldArea(): Area {
		return this.component.worldArea;
	}

	public setGeometry(area: Area | null, polygons: Polygon[] | null): void {
		this.component.setLocalCircle(null);
		this.component.setLocalArea(area);
		this.component.setLocalPolygons(polygons);
	}
}

export class ConsoleColliderManager {
	private readonly colliders = new Map<string, ConsoleColliderObject>();

	public create(id: string, opts: ColliderCreateOptions): void {
		if (this.colliders.has(id)) {
			throw new Error(`[ConsoleColliders] Collider '${id}' already exists.`);
		}
		this.upsert(id, opts);
	}

	public remove(id: string): void {
		const obj = this.colliders.get(id);
		if (!obj) return;
		this.colliders.delete(id);
		$.exile(obj);
	}

	public clear(): void {
		for (const [, obj] of this.colliders) {
			$.exile(obj);
		}
		this.colliders.clear();
	}

	public upsert(id: string, opts: ColliderCreateOptions): ConsoleColliderObject {
		const existing = this.colliders.get(id);
		if (!existing) {
			const obj = new ConsoleColliderObject(id, opts);
			this.colliders.set(id, obj);
			const spawnPos = new_vec3(obj.pos.x, obj.pos.y, obj.pos.z);
			$.world.spawn(obj, spawnPos);
			return obj;
		}
		existing.applyOptions(opts);
		return existing;
	}

	public has(id: string): boolean {
		return this.colliders.has(id);
	}

	public setPosition(id: string, centerX: number, centerY: number): void {
		const obj = this.require(id);
		obj.setPosition(centerX, centerY);
	}

	public overlap(aId: string, bId: string): boolean {
		const a = this.require(aId).getCollider();
		const b = this.require(bId).getCollider();
		return Collision2DSystem.collides(a, b);
	}

	public contact(aId: string, bId: string): ColliderContactInfo | null {
		const aObj = this.colliders.get(aId);
		const bObj = this.colliders.get(bId);
		if (!aObj || !bObj) return null;
		const a = aObj.getCollider();
		const b = bObj.getCollider();
		if (!Collision2DSystem.collides(a, b)) return null;
		const contact = Collision2DSystem.getContact2D(a, b);
		if (!contact || !contact.normal) {
			return { normalX: 0, normalY: 0, depth: contact?.depth ?? null };
		}
		return {
			normalX: contact.normal.x,
			normalY: contact.normal.y,
			depth: contact.depth ?? null,
		};
	}

	private require(id: string): ConsoleColliderObject {
		const obj = this.colliders.get(id);
		if (!obj) throw new Error(`[ConsoleColliders] Collider '${id}' not found.`);
		return obj;
	}
}
