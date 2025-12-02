export type CollisionProfile = { layer: number; mask: number };

/** Simple named collision profile registry (2D/3D agnostic). */
export class CollisionProfileRegistry {
	private static _profiles = new Map<string, CollisionProfile>();

	static define(name: string, profile: CollisionProfile): void {
		this._profiles.set(name, profile);
	}

	static get(name: string): CollisionProfile {
		return this._profiles.get(name);
	}

	static apply<T extends { layer: number; mask: number }>(collider: T, name: string): T {
		const p = this._profiles.get(name);
		if (!p) throw new Error(`[CollisionProfile] Unknown profile '${name}'.`);
		collider.layer = p.layer;
		collider.mask = p.mask;
		return collider;
	}
}

// Define a few sensible defaults (bit 0 reserved for 'default')
CollisionProfileRegistry.define('default', { layer: 1 << 0, mask: 0xFFFFFFFF });
CollisionProfileRegistry.define('ui', { layer: 1 << 1, mask: (1 << 1) });
CollisionProfileRegistry.define('player', { layer: 1 << 2, mask: (1 << 0) | (1 << 3) | (1 << 4) });
CollisionProfileRegistry.define('enemy', { layer: 1 << 3, mask: (1 << 0) | (1 << 2) | (1 << 4) });
CollisionProfileRegistry.define('projectile', { layer: 1 << 4, mask: (1 << 3) | (1 << 2) });

