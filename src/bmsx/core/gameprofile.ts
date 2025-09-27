export type GameProfileId = 'gameplay' | 'headless' | 'editor';

export interface GameProfile {
	readonly id: GameProfileId | string;
	readonly label: string;
	readonly requireView: boolean;
	readonly requireAudio: boolean;
	readonly defaultPipeline: GameProfileId;
}

export type GameProfileSelection = GameProfileId | GameProfile;

const BUILTIN_PROFILES: Record<GameProfileId, GameProfile> = {
	gameplay: { id: 'gameplay', label: 'Gameplay', requireView: true, requireAudio: true, defaultPipeline: 'gameplay' },
	headless: { id: 'headless', label: 'Headless', requireView: false, requireAudio: false, defaultPipeline: 'headless' },
	editor: { id: 'editor', label: 'Editor', requireView: true, requireAudio: true, defaultPipeline: 'editor' },
};

function cloneProfile(profile: GameProfile): GameProfile {
	return {
		id: profile.id,
		label: profile.label,
		requireView: profile.requireView,
		requireAudio: profile.requireAudio,
		defaultPipeline: profile.defaultPipeline,
	};
}

export function resolveGameProfile(selection?: GameProfileSelection): GameProfile {
	if (selection === undefined) return cloneProfile(BUILTIN_PROFILES.gameplay);
	if (typeof selection === 'string') {
		const builtin = BUILTIN_PROFILES[selection as GameProfileId];
		if (!builtin) {
			throw new Error(`[GameProfile] Unknown profile '${selection}'.`);
		}
		return cloneProfile(builtin);
	}
	return cloneProfile(selection);
}
