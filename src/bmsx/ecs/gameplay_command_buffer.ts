import type { AbilityId } from '../gas/gastypes';
import type { Identifier, vec3 } from '../rompack/rompack';

type Move2DCommandBase = {
	target_id: Identifier;
	delta: vec3;
};

export type MoveTo2DCommand = Move2DCommandBase & {
	kind: 'moveto2d';
};

export type MoveBy2DCommand = Move2DCommandBase & {
	kind: 'moveby2d';
};

export type ActivateAbilityCommand = {
	kind: 'ActivateAbility';
	owner: Identifier;
	target_id?: Identifier;
	ability_id: AbilityId;
	payload?: Record<string, unknown>;
	source?: string;
};

export type DispatchEventCommand = {
	kind: 'dispatchEvent';
	target_id: Identifier;
	event: string;
	emitter_id?: Identifier;
	payload?: unknown;
};

export type GameplayCommand = MoveTo2DCommand | MoveBy2DCommand | ActivateAbilityCommand | DispatchEventCommand;

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

	public drainAll(): GameplayCommandWithMeta[] {
		const drained = this.commands;
		this.commands = [];
		return drained;
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
		return this.commands;
	}
}
