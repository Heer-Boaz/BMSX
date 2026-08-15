import {
	type YamlLineToken as LineToken,
	type YamlMappingLineToken as MappingLineToken,
	tokenizeYamlStructureLine,
} from '../yaml/syntax/parser';
import {
	AEM_ACTION_KEYS,
	AEM_CHOICE_ACTION_KEYS,
	AEM_DOCUMENT_KEYS,
	AEM_EVENT_KEYS,
	AEM_FILTER_KEYS,
	AEM_MATCHER_KEYS,
	AEM_MODULATION_KEYS,
	AEM_MUSIC_TRANSITION_KEYS,
	AEM_RULE_KEYS,
	AEM_STINGER_SYNC_KEYS,
	AEM_STOP_MUSIC_KEYS,
} from '../../../toolchain/ts/rompack/aem_contract';

const BLOCK_INDENT = 4;
const SEQUENCE_ITEM_KEY_OFFSET = 2;

const CONDITION_EXIT_KEYS = new Set([
	...AEM_DOCUMENT_KEYS,
	...AEM_EVENT_KEYS,
	...AEM_RULE_KEYS,
	...AEM_ACTION_KEYS,
]);

type RootContext = {
	kind: 'root';
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

type MatcherSequenceContext = {
	kind: 'matcher-seq';
	itemIndent: number;
};

type ScalarSequenceContext = {
	kind: 'scalar-seq';
	itemIndent: number;
};

type ActionMapContext = {
	kind: 'action-map';
	indent: number;
	choice: boolean;
};

type ActionSequenceContext = {
	kind: 'action-seq';
	itemIndent: number;
	choice: boolean;
};

type StopMusicMapContext = {
	kind: 'stop-music-map';
	indent: number;
};

type ModulationMapContext = {
	kind: 'modulation-map';
	indent: number;
};

type FilterMapContext = {
	kind: 'filter-map';
	indent: number;
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
	| MatcherSequenceContext
	| ScalarSequenceContext
	| ActionMapContext
	| ActionSequenceContext
	| StopMusicMapContext
	| ModulationMapContext
	| FilterMapContext
	| MusicTransitionMapContext
	| SyncMapContext;

type Placement = {
	indent: number;
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

function createMatcherSequence(itemIndent: number): MatcherSequenceContext {
	return { kind: 'matcher-seq', itemIndent };
}

function createScalarSequence(itemIndent: number): ScalarSequenceContext {
	return { kind: 'scalar-seq', itemIndent };
}

function createActionMap(indent: number, choice: boolean): ActionMapContext {
	return { kind: 'action-map', indent, choice };
}

function createActionSequence(itemIndent: number, choice: boolean): ActionSequenceContext {
	return { kind: 'action-seq', itemIndent, choice };
}

function createStopMusicMap(indent: number): StopMusicMapContext {
	return { kind: 'stop-music-map', indent };
}

function createModulationMap(indent: number): ModulationMapContext {
	return { kind: 'modulation-map', indent };
}

function createFilterMap(indent: number): FilterMapContext {
	return { kind: 'filter-map', indent };
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

function buildMatcherChildContexts(keyLower: string, childIndent: number): Context[] {
	if (keyLower === 'and' || keyLower === 'or') {
		return [createMatcherSequence(childIndent)];
	}
	if (keyLower === 'not') {
		return [createWhenMap(childIndent)];
	}
	if (keyLower === 'has_tag') {
		return [createScalarSequence(childIndent)];
	}
	return [createConditionMap(childIndent)];
}

function isActionKey(keyLower: string, choice: boolean): boolean {
	return (choice ? AEM_CHOICE_ACTION_KEYS : AEM_ACTION_KEYS).has(keyLower);
}

function buildActionChildContexts(keyLower: string, childIndent: number, choice: boolean): Context[] {
	if (keyLower === 'modulation_params') {
		return [createModulationMap(childIndent)];
	}
	if (choice) {
		return [];
	}
	if (keyLower === 'stop_music') {
		return [createStopMusicMap(childIndent)];
	}
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

function placeInRoot(token: MappingLineToken): Placement | null {
	if (!AEM_DOCUMENT_KEYS.has(token.keyLower)) {
		return null;
	}
	return {
		indent: 0,
		push: token.opensBlock ? [createEventsMap(BLOCK_INDENT)] : [],
	};
}

function placeInContext(context: Context, token: LineToken): Placement | null {
	switch (context.kind) {
		case 'root': {
			return token.kind === 'mapping' ? placeInRoot(token) : null;
		}
		case 'events-map': {
			if (token.kind !== 'mapping') {
				return null;
			}
			return {
				indent: context.indent,
				push: token.opensBlock ? [createEventMap(context.indent + BLOCK_INDENT)] : [],
			};
		}
		case 'event-map': {
			if (token.kind !== 'mapping' || !AEM_EVENT_KEYS.has(token.keyLower)) {
				return null;
			}
			return {
				indent: context.indent,
				push: token.keyLower === 'rules' && token.opensBlock
					? [createRulesSequence(context.indent + BLOCK_INDENT)]
					: [],
			};
		}
		case 'rules-seq': {
			if (token.kind !== 'sequence-mapping' && token.kind !== 'sequence-scalar') {
				return null;
			}
			if (token.kind === 'sequence-scalar') {
				return { indent: context.itemIndent };
			}
			const itemMapIndent = context.itemIndent + SEQUENCE_ITEM_KEY_OFFSET;
			const childIndent = itemMapIndent + BLOCK_INDENT;
			return {
				indent: context.itemIndent,
				push: [
					createRuleItemMap(itemMapIndent),
					...(token.opensBlock
						? (token.keyLower === 'when'
							? [createWhenMap(childIndent)]
							: token.keyLower === 'go'
								? [createActionMap(childIndent, false)]
								: [])
						: []),
				],
			};
		}
		case 'rule-item-map': {
			if (token.kind !== 'mapping' || !AEM_RULE_KEYS.has(token.keyLower)) {
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
		}
		case 'when-map': {
			if (token.kind !== 'mapping' || !AEM_MATCHER_KEYS.has(token.keyLower)) {
				return null;
			}
			return {
				indent: context.indent,
				push: token.opensBlock ? buildMatcherChildContexts(token.keyLower, context.indent + BLOCK_INDENT) : [],
			};
		}
		case 'condition-map': {
			if (token.kind !== 'mapping' || !isConditionKey(token.keyLower)) {
				return null;
			}
			return {
				indent: context.indent,
				push: token.opensBlock ? [createScalarSequence(context.indent + BLOCK_INDENT)] : [],
			};
		}
		case 'matcher-seq': {
			if (token.kind !== 'sequence-mapping' || !AEM_MATCHER_KEYS.has(token.keyLower)) {
				return null;
			}
			const itemMapIndent = context.itemIndent + SEQUENCE_ITEM_KEY_OFFSET;
			return {
				indent: context.itemIndent,
				push: [
					createWhenMap(itemMapIndent),
					...(token.opensBlock
						? buildMatcherChildContexts(token.keyLower, itemMapIndent + BLOCK_INDENT)
						: []),
				],
			};
		}
		case 'scalar-seq': {
			return token.kind === 'sequence-scalar'
				? { indent: context.itemIndent }
				: null;
		}
		case 'action-map': {
			if (token.kind !== 'mapping' || !isActionKey(token.keyLower, context.choice)) {
				return null;
			}
			return {
				indent: context.indent,
				push: token.opensBlock ? buildActionChildContexts(token.keyLower, context.indent + BLOCK_INDENT, context.choice) : [],
			};
		}
		case 'action-seq': {
			if (token.kind !== 'sequence-mapping' && token.kind !== 'sequence-scalar') {
				return null;
			}
			if (token.kind === 'sequence-scalar') {
				return { indent: context.itemIndent };
			}
			const itemMapIndent = context.itemIndent + SEQUENCE_ITEM_KEY_OFFSET;
			return {
				indent: context.itemIndent,
				push: [
					createActionMap(itemMapIndent, context.choice),
					...(token.opensBlock
						? buildActionChildContexts(token.keyLower, itemMapIndent + BLOCK_INDENT, context.choice)
						: []),
				],
			};
		}
		case 'stop-music-map': {
			if (token.kind !== 'mapping' || !AEM_STOP_MUSIC_KEYS.has(token.keyLower)) {
				return null;
			}
			return { indent: context.indent };
		}
		case 'modulation-map': {
			if (token.kind !== 'mapping' || !AEM_MODULATION_KEYS.has(token.key)) {
				return null;
			}
			return {
				indent: context.indent,
				push: token.keyLower === 'filter' && token.opensBlock
					? [createFilterMap(context.indent + BLOCK_INDENT)]
					: [],
			};
		}
		case 'filter-map': {
			if (token.kind !== 'mapping' || !AEM_FILTER_KEYS.has(token.keyLower)) {
				return null;
			}
			return { indent: context.indent };
		}
		case 'music-transition-map': {
			if (token.kind !== 'mapping' || !AEM_MUSIC_TRANSITION_KEYS.has(token.keyLower)) {
				return null;
			}
			return {
				indent: context.indent,
				push: token.keyLower === 'sync' && token.opensBlock
					? [createSyncMap(context.indent + BLOCK_INDENT)]
					: [],
			};
		}
		case 'sync-map': {
			if (token.kind !== 'mapping' || !AEM_STINGER_SYNC_KEYS.has(token.keyLower)) {
				return null;
			}
			return {
				indent: context.indent,
			};
		}
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
	const stack: Context[] = [{ kind: 'root' }];

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
