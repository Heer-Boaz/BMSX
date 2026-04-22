import {
	type YamlLineToken as LineToken,
	type YamlMappingLineToken as MappingLineToken,
	tokenizeYamlStructureLine,
} from '../yaml/yaml_syntax_parser';

const BLOCK_INDENT = 4;
const SEQUENCE_ITEM_KEY_OFFSET = 2;

const EVENT_META_KEYS = new Set([
	'$type',
	'name',
	'kind',
	'channel',
	'policy',
	'rules',
]);

const RULE_ITEM_KEYS = new Set([
	'when',
	'go',
]);

const ACTION_KEYS = new Set([
	'audio_id',
	'modulation_preset',
	'priority',
	'cooldown_ms',
	'stop_music',
	'music_transition',
	'sequence',
	'one_of',
]);

const MUSIC_TRANSITION_KEYS = new Set([
	'audio_id',
	'sync',
	'fade_ms',
	'start_at_loop_start',
	'start_fresh',
]);

const SYNC_KEYS = new Set([
	'stinger',
	'return_to',
	'return_to_previous',
	'delay_ms',
]);

const CONDITION_EXIT_KEYS = new Set([
	'events',
	'$type',
	'name',
	'kind',
	'channel',
	'policy',
	'rules',
	'when',
	'go',
]);

type RootMode = 'unknown' | 'events' | 'event' | 'direct-events';

type RootContext = {
	kind: 'root';
	mode: RootMode;
};

type EventsMapContext = {
	kind: 'events-map';
	indent: number;
};

type EventMapContext = {
	kind: 'event-map';
	indent: number;
};

type RulesSequenceContext = {
	kind: 'rules-seq';
	itemIndent: number;
};

type RuleItemMapContext = {
	kind: 'rule-item-map';
	indent: number;
};

type WhenMapContext = {
	kind: 'when-map';
	indent: number;
};

type ConditionMapContext = {
	kind: 'condition-map';
	indent: number;
};

type ActionMapContext = {
	kind: 'action-map';
	indent: number;
	allowWeight: boolean;
};

type ActionSequenceContext = {
	kind: 'action-seq';
	itemIndent: number;
	allowWeight: boolean;
};

type MusicTransitionMapContext = {
	kind: 'music-transition-map';
	indent: number;
};

type SyncMapContext = {
	kind: 'sync-map';
	indent: number;
};

type Context =
	| RootContext
	| EventsMapContext
	| EventMapContext
	| RulesSequenceContext
	| RuleItemMapContext
	| WhenMapContext
	| ConditionMapContext
	| ActionMapContext
	| ActionSequenceContext
	| MusicTransitionMapContext
	| SyncMapContext;

type Placement = {
	indent: number;
	nextRootMode?: RootMode;
	push?: Context[];
};

function createEventsMap(indent: number): EventsMapContext {
	return { kind: 'events-map', indent };
}

function createEventMap(indent: number): EventMapContext {
	return { kind: 'event-map', indent };
}

function createRulesSequence(itemIndent: number): RulesSequenceContext {
	return { kind: 'rules-seq', itemIndent };
}

function createRuleItemMap(indent: number): RuleItemMapContext {
	return { kind: 'rule-item-map', indent };
}

function createWhenMap(indent: number): WhenMapContext {
	return { kind: 'when-map', indent };
}

function createConditionMap(indent: number): ConditionMapContext {
	return { kind: 'condition-map', indent };
}

function createActionMap(indent: number, allowWeight: boolean): ActionMapContext {
	return { kind: 'action-map', indent, allowWeight };
}

function createActionSequence(itemIndent: number, allowWeight: boolean): ActionSequenceContext {
	return { kind: 'action-seq', itemIndent, allowWeight };
}

function createMusicTransitionMap(indent: number): MusicTransitionMapContext {
	return { kind: 'music-transition-map', indent };
}

function createSyncMap(indent: number): SyncMapContext {
	return { kind: 'sync-map', indent };
}

function isConditionKey(keyLower: string): boolean {
	return !CONDITION_EXIT_KEYS.has(keyLower);
}

function isActionKey(keyLower: string, allowWeight: boolean): boolean {
	return ACTION_KEYS.has(keyLower) || (allowWeight && keyLower === 'weight');
}

function buildActionChildContexts(keyLower: string, childIndent: number): Context[] {
	if (keyLower === 'music_transition') {
		return [createMusicTransitionMap(childIndent)];
	}
	if (keyLower === 'sequence') {
		return [createActionSequence(childIndent, false)];
	}
	if (keyLower === 'one_of') {
		return [createActionSequence(childIndent, true)];
	}
	return [];
}

function placeInRoot(context: RootContext, token: MappingLineToken): Placement {
	if (context.mode === 'unknown') {
		if (token.keyLower === 'events' && token.opensBlock) {
			return {
				indent: 0,
				nextRootMode: 'events',
				push: [createEventsMap(BLOCK_INDENT)],
			};
		}
		if (EVENT_META_KEYS.has(token.keyLower)) {
			const push = token.keyLower === 'rules' && token.opensBlock
				? [createRulesSequence(BLOCK_INDENT)]
				: [];
			return {
				indent: 0,
				nextRootMode: 'event',
				push,
			};
		}
		return {
			indent: 0,
			nextRootMode: 'direct-events',
			push: token.opensBlock ? [createEventMap(BLOCK_INDENT)] : [],
		};
	}
	if (context.mode === 'event') {
		if (!EVENT_META_KEYS.has(token.keyLower)) {
			return null;
		}
		return {
			indent: 0,
			push: token.keyLower === 'rules' && token.opensBlock
				? [createRulesSequence(BLOCK_INDENT)]
				: [],
		};
	}
	return {
		indent: 0,
		push: token.opensBlock
			? [token.keyLower === 'events' ? createEventsMap(BLOCK_INDENT) : createEventMap(BLOCK_INDENT)]
			: [],
	};
}

function placeInContext(context: Context, token: LineToken): Placement | null {
	switch (context.kind) {
		case 'root':
			return token.kind === 'mapping' ? placeInRoot(context, token) : null;
		case 'events-map':
			if (token.kind !== 'mapping') {
				return null;
			}
			return {
				indent: context.indent,
				push: token.opensBlock ? [createEventMap(context.indent + BLOCK_INDENT)] : [],
			};
		case 'event-map':
			if (token.kind !== 'mapping' || !EVENT_META_KEYS.has(token.keyLower)) {
				return null;
			}
			return {
				indent: context.indent,
				push: token.keyLower === 'rules' && token.opensBlock
					? [createRulesSequence(context.indent + BLOCK_INDENT)]
					: [],
			};
		case 'rules-seq':
			if (token.kind !== 'sequence-mapping' && token.kind !== 'sequence-scalar') {
				return null;
			}
			if (token.kind === 'sequence-scalar') {
				return { indent: context.itemIndent };
			}
			return {
				indent: context.itemIndent,
				push: [
					createRuleItemMap(context.itemIndent + SEQUENCE_ITEM_KEY_OFFSET),
					...(token.opensBlock
						? (token.keyLower === 'when'
							? [createWhenMap(context.itemIndent + SEQUENCE_ITEM_KEY_OFFSET + BLOCK_INDENT)]
							: token.keyLower === 'go'
								? [createActionMap(context.itemIndent + SEQUENCE_ITEM_KEY_OFFSET + BLOCK_INDENT, false)]
								: [])
						: []),
				],
			};
		case 'rule-item-map':
			if (token.kind !== 'mapping' || !RULE_ITEM_KEYS.has(token.keyLower)) {
				return null;
			}
			return {
				indent: context.indent,
				push: token.opensBlock
					? (token.keyLower === 'when'
						? [createWhenMap(context.indent + BLOCK_INDENT)]
						: [createActionMap(context.indent + BLOCK_INDENT, false)])
					: [],
			};
		case 'when-map':
			if (token.kind !== 'mapping' || !isConditionKey(token.keyLower)) {
				return null;
			}
			return {
				indent: context.indent,
				push: token.opensBlock ? [createConditionMap(context.indent + BLOCK_INDENT)] : [],
			};
		case 'condition-map':
			if (token.kind !== 'mapping' || !isConditionKey(token.keyLower)) {
				return null;
			}
			return {
				indent: context.indent,
				push: token.opensBlock ? [createConditionMap(context.indent + BLOCK_INDENT)] : [],
			};
		case 'action-map':
			if (token.kind !== 'mapping' || !isActionKey(token.keyLower, context.allowWeight)) {
				return null;
			}
			return {
				indent: context.indent,
				push: token.opensBlock ? buildActionChildContexts(token.keyLower, context.indent + BLOCK_INDENT) : [],
			};
		case 'action-seq':
			if (token.kind !== 'sequence-mapping' && token.kind !== 'sequence-scalar') {
				return null;
			}
			if (token.kind === 'sequence-scalar') {
				return { indent: context.itemIndent };
			}
			return {
				indent: context.itemIndent,
				push: [
					createActionMap(context.itemIndent + SEQUENCE_ITEM_KEY_OFFSET, context.allowWeight),
					...(token.opensBlock
						? buildActionChildContexts(token.keyLower, context.itemIndent + SEQUENCE_ITEM_KEY_OFFSET + BLOCK_INDENT)
						: []),
				],
			};
		case 'music-transition-map':
			if (token.kind !== 'mapping' || !MUSIC_TRANSITION_KEYS.has(token.keyLower)) {
				return null;
			}
			return {
				indent: context.indent,
				push: token.keyLower === 'sync' && token.opensBlock
					? [createSyncMap(context.indent + BLOCK_INDENT)]
					: [],
			};
		case 'sync-map':
			if (token.kind !== 'mapping' || !SYNC_KEYS.has(token.keyLower)) {
				return null;
			}
			return {
				indent: context.indent,
			};
	}
}

function findNextIndent(indents: Array<number | null>, startIndex: number): number | null {
	for (let index = startIndex; index < indents.length; index += 1) {
		const indent = indents[index];
		if (indent !== null) {
			return indent;
		}
	}
	return null;
}

function findPreviousIndent(indents: Array<number | null>, startIndex: number): number | null {
	for (let index = startIndex; index >= 0; index -= 1) {
		const indent = indents[index];
		if (indent !== null) {
			return indent;
		}
	}
	return null;
}

export function formatAemYamlDocument(source: string, lines: readonly string[]): string {
	if (source.length === 0) {
		return '';
	}
	const hadTrailingNewline = source.endsWith('\n');
	const tokens = lines.map(tokenizeYamlStructureLine);
	const indents: Array<number | null> = new Array(lines.length);
	const stack: Context[] = [{ kind: 'root', mode: 'unknown' }];

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]!;
		if (token.kind === 'blank' || token.kind === 'comment') {
			indents[index] = null;
			continue;
		}
		let placed = false;
		for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
			const placement = placeInContext(stack[depth]!, token);
			if (!placement) {
				continue;
			}
			stack.length = depth + 1;
			if (placement.nextRootMode) {
				(stack[0] as RootContext).mode = placement.nextRootMode;
			}
			if (placement.push && placement.push.length > 0) {
				for (let pushIndex = 0; pushIndex < placement.push.length; pushIndex += 1) {
					stack.push(placement.push[pushIndex]!);
				}
			}
			indents[index] = placement.indent;
			placed = true;
			break;
		}
		if (!placed) {
			throw new Error(`Unable to infer AEM YAML indentation for line ${index + 1}: ${token.text}`);
		}
	}

	const formattedLines: string[] = new Array(lines.length);
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]!;
		if (token.kind === 'blank') {
			formattedLines[index] = '';
			continue;
		}
		if (token.kind === 'comment') {
			const nextIndent = findNextIndent(indents, index + 1);
			const previousIndent = findPreviousIndent(indents, index - 1);
			const indent = nextIndent ?? previousIndent ?? 0;
			formattedLines[index] = `${' '.repeat(indent)}${token.text}`;
			continue;
		}
		formattedLines[index] = `${' '.repeat(indents[index] ?? 0)}${token.text}`;
	}

	let formatted = formattedLines.join('\n');
	if (hadTrailingNewline) {
		formatted += '\n';
	}
	return formatted;
}
