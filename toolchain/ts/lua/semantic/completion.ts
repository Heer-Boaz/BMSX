import { LuaMemberOperator } from '../syntax/ast';
import type { FileSemanticData } from './model';
import { findOrderedSourceRangeEntryAtPosition } from './source_range';
import {
	semanticValueSourceKey,
	type SemanticValueSource,
} from './value_graph';

export type LuaMemberCompletionContext = {
	readonly receiverKey: string;
	readonly operator: '.' | ':' | '->';
	readonly receiver: SemanticValueSource;
	readonly namePath?: readonly string[];
};

export function findLuaMemberCompletionContext(
	source: FileSemanticData,
	line: number,
	memberStartColumn: number,
): LuaMemberCompletionContext | null {
	const access = findOrderedSourceRangeEntryAtPosition(
		source.memberAccesses,
		line,
		memberStartColumn,
	);
	if (access === undefined) {
		return null;
	}
	const receiverKey = semanticValueSourceKey(access.receiver);
	const operator = access.operator === LuaMemberOperator.Dot
		? '.'
		: access.operator === LuaMemberOperator.Colon
			? ':'
			: '->';
	if (access.namePath !== undefined) {
		return { receiverKey, operator, receiver: access.receiver, namePath: access.namePath };
	}
	return { receiverKey, operator, receiver: access.receiver };
}
