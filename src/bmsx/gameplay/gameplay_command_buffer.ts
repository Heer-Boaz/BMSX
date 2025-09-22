import type { Identifier } from '../rompack/rompack';
import type { AbilityId } from '../gas/gastypes';

export type GameplayCommand =
	| {
		kind: 'ActivateAbility';
		ownerId: Identifier;
		abilityId: AbilityId;
		payload?: Record<string, unknown>;
		source?: string;
		frame: number;
		sequence: number;
	};

/**
 * Frame-scoped gameplay command buffer drained by ECS systems.
 */
export class GameplayCommandBuffer {
	public static readonly instance = new GameplayCommandBuffer();

	private frame: number = 0;
	private sequence: number = 0;
	private commands: GameplayCommand[] = [];

	private constructor() { }

	public beginFrame(frame: number): void {
		if (this.commands.length > 0) {
			console.warn('[GameplayCommandBuffer] Clearing residual commands at frame start.');
			this.commands = [];
		}
		this.frame = frame;
		this.sequence = 0;
	}

	public push(command: Omit<GameplayCommand, 'frame' | 'sequence'>): GameplayCommand {
		const entry: GameplayCommand = {
			...command,
			frame: this.frame,
			sequence: this.sequence++,
		};
		this.commands.push(entry);
		return entry;
	}

	public drain<K extends GameplayCommand['kind']>(kind?: K): Extract<GameplayCommand, { kind: K }>[] {
		if (kind === undefined) {
			const drained = this.commands;
			this.commands = [];
			return drained as Extract<GameplayCommand, { kind: K }>[];
		}
		const kept: GameplayCommand[] = [];
		const drained: Extract<GameplayCommand, { kind: K }>[] = [];
		for (let i = 0; i < this.commands.length; i++) {
			const entry = this.commands[i]!;
			if (entry.kind === kind) {
				drained.push(entry as Extract<GameplayCommand, { kind: K }>);
			} else {
				kept.push(entry);
			}
		}
		this.commands = kept;
		return drained;
	}

	public snapshot(): ReadonlyArray<GameplayCommand> {
		return this.commands;
	}
}
