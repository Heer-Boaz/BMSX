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

export type AnalysisRegion = {
	kind: string;
	labels: readonly string[];
	startLine: number;
	endLine: number;
};

export type AnalysisStatement = {
	kind: string;
	labels: readonly string[];
	line: number;
};

type AnalysisDirective = {
	line: number;
	command: string;
	rest: string;
};

const SUPPRESSION_MODE_PREFIXES: ReadonlyArray<{ prefix: string; mode: LintSuppressionMode }> = [
	{ prefix: '-next-line', mode: 'next-line' },
	{ prefix: 'next-line', mode: 'next-line' },
	{ prefix: '-line', mode: 'line' },
	{ prefix: 'line', mode: 'line' },
];

function commentText(lineText: string): string | null {
	const lineCommentIndex = lineText.indexOf('//');
	const blockCommentIndex = lineText.indexOf('/*');
	if (lineCommentIndex === -1 && blockCommentIndex === -1) {
		return null;
	}
	const commentIndex = lineCommentIndex === -1
		? blockCommentIndex
		: blockCommentIndex === -1
			? lineCommentIndex
			: Math.min(lineCommentIndex, blockCommentIndex);
	const text = lineText.slice(commentIndex + 2).replace(/\*\/\s*$/, '').trimStart();
	return text.length === 0 ? null : text;
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
	for (let index = 0; index < SUPPRESSION_MODE_PREFIXES.length; index += 1) {
		const prefix = SUPPRESSION_MODE_PREFIXES[index];
		if (rest.startsWith(prefix.prefix)) {
			return {
				mode: prefix.mode,
				rest: rest.slice(prefix.prefix.length),
			};
		}
	}
	return { mode: 'file', rest };
}

function findAnalysisDirective(lineText: string, line: number): AnalysisDirective | null {
	const text = commentText(lineText);
	if (text === null) {
		return null;
	}
	const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text)!;
	return {
		line,
		command: match[1],
		rest: match[2] === undefined ? '' : match[2],
	};
}

function parseSuppressionDirective(lineText: string, line: number): LintSuppressionDirective | null {
	const directive = findAnalysisDirective(lineText, line);
	if (directive === null || (directive.command !== 'disable' && !directive.command.startsWith('disable-'))) {
		return null;
	}
	const modeText = directive.command === 'disable'
		? directive.rest
		: `${directive.command.slice('disable'.length)} ${directive.rest}`;
	const { mode, rest } = parseDirectiveMode(modeText);
	return {
		line,
		mode,
		rules: parseSuppressedRules(rest),
	};
}

function parseLintSuppressionDirectives(sourceText: string): LintSuppressionDirective[] {
	const directives: LintSuppressionDirective[] = [];
	// disable-next-line newline_normalization_pattern -- directive parser must accept source files with any line ending.
	const lines = sourceText.split(/\r\n|\r|\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const directive = parseSuppressionDirective(lines[index], index + 1);
		if (directive !== null) {
			directives.push(directive);
		}
	}
	return directives;
}

type AnalysisRegionHeader = {
	kind: string;
	labels: string[];
};

function parseRegionHeader(text: string): AnalysisRegionHeader | null {
	const descriptionStart = text.search(/\s--(?:\s|$)/);
	const kindText = descriptionStart === -1 ? text : text.slice(0, descriptionStart);
	const parts = kindText.replace(/\*\//g, ' ').trim().split(/[,\s]+/);
	const labels: string[] = [];
	let kind = '';
	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index].replace(/^[^A-Za-z0-9_$./*-]+|[^A-Za-z0-9_$./*-]+$/g, '');
		if (part.length === 0) {
			continue;
		}
		if (kind.length === 0) {
			kind = part;
		} else {
			labels.push(part);
		}
	}
	return kind.length === 0 ? null : { kind, labels };
}

function directiveIsReservedForSuppressionOrRegion(directive: AnalysisDirective): boolean {
	switch (directive.command) {
		case 'start':
		case 'end':
		case 'disable':
			return true;
		default:
			return directive.command.startsWith('disable-');
	}
}

export function collectAnalysisStatements(sourceText: string): AnalysisStatement[] {
	const statements: AnalysisStatement[] = [];
	// disable-next-line newline_normalization_pattern -- directive parser must accept source files with any line ending.
	const lines = sourceText.split(/\r\n|\r|\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const directive = findAnalysisDirective(lines[index], index + 1);
		if (directive === null || directiveIsReservedForSuppressionOrRegion(directive)) {
			continue;
		}
		const header = parseRegionHeader(`${directive.command} ${directive.rest}`);
		if (header !== null) {
			statements.push({ kind: header.kind, labels: header.labels, line: directive.line });
		}
	}
	return statements;
}

export function hasAnalysisStatement(statements: readonly AnalysisStatement[], kind: string): boolean {
	for (let index = 0; index < statements.length; index += 1) {
		if (statements[index].kind === kind) {
			return true;
		}
	}
	return false;
}

export function collectAnalysisRegions(sourceText: string): AnalysisRegion[] {
	const regions: AnalysisRegion[] = [];
	const activeStarts = new Map<string, Array<{ line: number; labels: readonly string[] }>>();
	// disable-next-line newline_normalization_pattern -- directive parser must accept source files with any line ending.
	const lines = sourceText.split(/\r\n|\r|\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = index + 1;
		const directive = findAnalysisDirective(lines[index], line);
		if (directive === null || directive.command !== 'start' && directive.command !== 'end') {
			continue;
		}
		const header = parseRegionHeader(directive.rest);
		if (header === null) {
			continue;
		}
		const { kind, labels } = header;
		if (directive.command === 'start') {
			let starts = activeStarts.get(kind);
			if (starts === undefined) {
				starts = [];
				activeStarts.set(kind, starts);
			}
			starts.push({ line: line + 1, labels });
			continue;
		}
		const starts = activeStarts.get(kind);
		if (starts === undefined || starts.length === 0) {
			continue;
		}
		const start = starts.pop()!;
		if (start.line <= line - 1) {
			regions.push({ kind, labels: start.labels, startLine: start.line, endLine: line - 1 });
		}
	}
	for (const [kind, starts] of activeStarts) {
		for (let index = 0; index < starts.length; index += 1) {
			const start = starts[index];
			regions.push({ kind, labels: start.labels, startLine: start.line, endLine: lines.length });
		}
	}
	regions.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine || a.kind.localeCompare(b.kind));
	return regions;
}

export function lineInAnalysisRegion(regions: readonly AnalysisRegion[], kind: string, line: number): boolean {
	for (let index = 0; index < regions.length; index += 1) {
		const region = regions[index];
		if (line < region.startLine) {
			return false;
		}
		if (region.kind === kind && line <= region.endLine) {
			return true;
		}
	}
	return false;
}

export function lineHasAnalysisRegionLabel(
	regions: readonly AnalysisRegion[],
	kind: string,
	line: number,
	label: string,
): boolean {
	for (let index = 0; index < regions.length; index += 1) {
		const region = regions[index];
		if (line < region.startLine) {
			return false;
		}
		if (region.kind !== kind || line > region.endLine) {
			continue;
		}
		if (region.labels.length === 0 || region.labels.includes('*') || region.labels.includes(label)) {
			return true;
		}
	}
	return false;
}

function directiveSuppressesIssue(directive: LintSuppressionDirective, issue: SuppressibleLintIssue): boolean {
	if (directive.rules === null || directive.rules.has('*') || !directive.rules.has(issue.kind)) {
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
