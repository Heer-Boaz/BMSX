import type { SourceRange } from '../source_range';
import type { InlineCallSite } from './program';

export const ROOT_INLINE_CALL_SITES: ReadonlyArray<InlineCallSite> = [];

type InlineLocalContext = {
	inlineCallSites: ReadonlyArray<InlineCallSite>;
};

const sourceRangesEqual = (left: SourceRange, right: SourceRange): boolean =>
	left.path === right.path
	&& left.start.line === right.start.line
	&& left.start.column === right.start.column
	&& left.end.line === right.end.line
	&& left.end.column === right.end.column;

const inlineCallSitesEqual = (left: InlineCallSite, right: InlineCallSite): boolean =>
	left.calleeFunctionId === right.calleeFunctionId
	&& sourceRangesEqual(left.callRange, right.callRange);

export function inlineCallChainContainsFunction(
	inlineCallSites: ReadonlyArray<InlineCallSite>,
	functionId: string,
): boolean {
	for (let index = 0; index < inlineCallSites.length; index += 1) {
		if (inlineCallSites[index].calleeFunctionId === functionId) {
			return true;
		}
	}
	return false;
}

export function resolveInlineLocalContextRange(
	local: InlineLocalContext,
	currentRange: SourceRange,
	currentInlineCallSites: ReadonlyArray<InlineCallSite>,
): SourceRange | null {
	const localInlineCallSites = local.inlineCallSites;
	if (localInlineCallSites.length > currentInlineCallSites.length) {
		return null;
	}
	for (let index = 0; index < localInlineCallSites.length; index += 1) {
		if (!inlineCallSitesEqual(localInlineCallSites[index], currentInlineCallSites[index])) {
			return null;
		}
	}
	return localInlineCallSites.length === currentInlineCallSites.length
		? currentRange
		: currentInlineCallSites[localInlineCallSites.length].callRange;
}
