export type SuppressibleLintIssue = {
	file: string;
	line: number;
	kind: string;
};

type LintSuppressionMode = 'file' | 'line' | 'next-line';

type LintSuppressionDirective = {
	line: number;
	mode: LintSuppressionMode;
	rules: ReadonlySet<string> | null;
};

const ANALYSIS_SUPPRESSION_MARKER = '@bmsx-analyse';

function markerIsInComment(lineText: string, markerIndex: number): boolean {
	const lineCommentIndex = lineText.indexOf('//');
	if (lineCommentIndex !== -1 && lineCommentIndex < markerIndex) {
		return true;
	}
	const blockCommentIndex = lineText.indexOf('/*');
	return blockCommentIndex !== -1 && blockCommentIndex < markerIndex;
}

function parseSuppressedRules(text: string): ReadonlySet<string> | null {
	const descriptionStart = text.search(/\s--(?:\s|$)/);
	const ruleText = descriptionStart === -1 ? text : text.slice(0, descriptionStart);
	const parts = ruleText.replace(/\*\//g, ' ').trim().split(/[,\s]+/);
	const rules = new Set<string>();
	for (let index = 0; index < parts.length; index += 1) {
		const rule = parts[index].replace(/^[^A-Za-z0-9_*./-]+|[^A-Za-z0-9_*./-]+$/g, '');
		if (rule.length > 0) {
			rules.add(rule);
		}
	}
	return rules.size === 0 ? null : rules;
}

function parseDirectiveMode(text: string): { mode: LintSuppressionMode; rest: string } {
	let rest = text.trimStart();
	let mode: LintSuppressionMode = 'file';
	if (rest.startsWith('-next-line')) {
		mode = 'next-line';
		rest = rest.slice('-next-line'.length);
	} else if (rest.startsWith('next-line')) {
		mode = 'next-line';
		rest = rest.slice('next-line'.length);
	} else if (rest.startsWith('-line')) {
		mode = 'line';
		rest = rest.slice('-line'.length);
	} else if (rest.startsWith('line')) {
		mode = 'line';
		rest = rest.slice('line'.length);
	}
	return { mode, rest };
}

function findSuppressionDirectiveText(lineText: string): { markerIndex: number; rest: string } | null {
	const analysisIndex = lineText.indexOf(ANALYSIS_SUPPRESSION_MARKER);
	if (analysisIndex === -1) {
		return null;
	}
	let rest = lineText.slice(analysisIndex + ANALYSIS_SUPPRESSION_MARKER.length).trimStart();
	if (!rest.startsWith('disable')) {
		return null;
	}
	rest = rest.slice('disable'.length);
	return {
		markerIndex: analysisIndex,
		rest,
	};
}

function parseSuppressionDirective(lineText: string, line: number): LintSuppressionDirective | null {
	const directiveText = findSuppressionDirectiveText(lineText);
	if (directiveText === null) {
		return null;
	}
	const markerIndex = directiveText.markerIndex;
	if (markerIndex === -1 || !markerIsInComment(lineText, markerIndex)) {
		return null;
	}
	const { mode, rest } = parseDirectiveMode(directiveText.rest);
	return {
		line,
		mode,
		rules: parseSuppressedRules(rest),
	};
}

function parseLintSuppressionDirectives(sourceText: string): LintSuppressionDirective[] {
	const directives: LintSuppressionDirective[] = [];
	const lines = sourceText.split(/\r\n|\r|\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const directive = parseSuppressionDirective(lines[index], index + 1);
		if (directive !== null) {
			directives.push(directive);
		}
	}
	return directives;
}

function directiveSuppressesIssue(directive: LintSuppressionDirective, issue: SuppressibleLintIssue): boolean {
	if (directive.rules !== null && !directive.rules.has('*') && !directive.rules.has(issue.kind)) {
		return false;
	}
	if (directive.mode === 'file') {
		return issue.line >= directive.line;
	}
	if (directive.mode === 'line') {
		return issue.line === directive.line;
	}
	return issue.line === directive.line + 1;
}

function issueIsSuppressed(issue: SuppressibleLintIssue, directives: readonly LintSuppressionDirective[]): boolean {
	for (let index = 0; index < directives.length; index += 1) {
		if (directiveSuppressesIssue(directives[index], issue)) {
			return true;
		}
	}
	return false;
}

export function filterSuppressedLintIssues<TIssue extends SuppressibleLintIssue>(
	issues: readonly TIssue[],
	sourceTextByFile: ReadonlyMap<string, string>,
): TIssue[] {
	const directivesByFile = new Map<string, readonly LintSuppressionDirective[]>();
	const result: TIssue[] = [];
	for (let index = 0; index < issues.length; index += 1) {
		const issue = issues[index];
		let directives = directivesByFile.get(issue.file);
		if (directives === undefined) {
			const sourceText = sourceTextByFile.get(issue.file);
			directives = sourceText === undefined ? [] : parseLintSuppressionDirectives(sourceText);
			directivesByFile.set(issue.file, directives);
		}
		if (!issueIsSuppressed(issue, directives)) {
			result.push(issue);
		}
	}
	return result;
}
