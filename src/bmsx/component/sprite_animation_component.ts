import { Component } from './basecomponent';
import { excludepropfromsavegame, insavegame } from '../serializer/serializationhooks';
import type { SpriteComponent } from './sprite_component';

export type SpriteAnimationDefinition = {
	frames: string[];
	fps?: number;
	loop?: boolean;
	next?: string | null;
};

type PendingPlayRequest = { name: string; restart: boolean };

@insavegame
export class SpriteAnimationComponent extends Component {
	public spriteId?: string;
	public animations: Record<string, SpriteAnimationDefinition> = {};
	public autoplay?: string;
	public playbackRate = 1;
	public current?: string;
	public frameIndex = 0;
	public elapsed = 0;
	public paused = false;

	@excludepropfromsavegame
	private _pending?: PendingPlayRequest;

	@excludepropfromsavegame
	private _spriteCache?: SpriteComponent | null;

	public play(name: string, options?: { restart?: boolean }): void {
		const trimmed = name.trim();
		if (trimmed.length === 0) {
			throw new Error('[SpriteAnimationComponent] play() requires a non-empty animation name.');
		}
		this._pending = { name: trimmed, restart: options?.restart ?? true };
		this.paused = false;
	}

	public stop(): void {
		this.paused = true;
	}

	public resume(): void {
		this.paused = false;
	}

	public get pending(): PendingPlayRequest | undefined {
		return this._pending;
	}

	public consumePending(): PendingPlayRequest | undefined {
		const pending = this._pending;
		this._pending = undefined;
		return pending;
	}

	public get cachedSprite(): SpriteComponent | null | undefined {
		return this._spriteCache;
	}

	public cacheSprite(sprite: SpriteComponent | null): void {
		this._spriteCache = sprite;
	}
}
