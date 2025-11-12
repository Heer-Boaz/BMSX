import type { AbilityId, AbilityPayloadFor } from '../gas/gastypes';
import type { Identifier, vec3 } from '../rompack/rompack';
import type { GameEvent } from '../core/game_event';

type CommandTable = {
	'moveto2d': { kind: 'moveto2d'; target_id: Identifier; delta: vec3; };
	'moveby2d': { kind: 'moveby2d'; target_id: Identifier; delta: vec3; };
	'posx': { kind: 'posx'; target_id: Identifier; x: number; };
	'posy': { kind: 'posy'; target_id: Identifier; y: number; };
	'posz': { kind: 'posz'; target_id: Identifier; z: number; };
	'activateability': { kind: 'activateability'; owner: Identifier; target_id?: Identifier; ability_id: AbilityId; payload?: AbilityPayloadFor<AbilityId>; };
	'emit': { kind: 'emit'; target_id: Identifier; event: GameEvent; };
};

export type CommandKind = keyof CommandTable;
export type GameplayCommand = CommandTable[CommandKind];
export type GameplayCommandWithMeta = GameplayCommand & { frame: number; seq: number };

/**
 * Frame-scoped gameplay command buffer drained by ECS systems.
 */
export class GameplayCommandBuffer {
	public static readonly instance = new GameplayCommandBuffer();

	private frame: number = 0;
	private seq: number = 0;
	private commands: GameplayCommandWithMeta[] = [];

	private constructor() { }

	public beginFrame(frame: number): void {
		this.frame = frame;
		this.seq = 0;
	}

	public push<C extends GameplayCommand>(command: C): void {
		this.commands.push({ ...command, frame: this.frame, seq: this.seq++ });
	}

	public drainByKind<K extends GameplayCommand['kind']>(kind: K): Extract<GameplayCommandWithMeta, { kind: K }>[] {
		const kept: GameplayCommandWithMeta[] = [];
		const matched: Extract<GameplayCommandWithMeta, { kind: K }>[] = [] as Extract<GameplayCommandWithMeta, { kind: K }>[];
		for (let i = 0; i < this.commands.length; i++) {
			const entry = this.commands[i]!;
			if (entry.kind === kind) matched.push(entry as Extract<GameplayCommandWithMeta, { kind: K }>);
			else kept.push(entry);
		}
		this.commands = kept;
		return matched;
	}

	public snapshot(): ReadonlyArray<GameplayCommandWithMeta> {
		return this.commands.slice();
	}
}
