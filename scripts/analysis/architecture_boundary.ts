import { dirname, resolve } from 'node:path';

import type { ArchitectureBoundaryConfig, ArchitectureBoundaryRule } from './config';

export function architectureBoundaryLayer(path: string, config: ArchitectureBoundaryConfig | null): string | null {
	if (config === null) {
		return null;
	}
	const parts = path.replace(/\\/g, '/').split('/');
	for (let index = 0; index < parts.length - 1; index += 1) {
		if (parts[index] === config.rootSegment && config.layers.includes(parts[index + 1])) {
			return parts[index + 1];
		}
	}
	return null;
}

export function architectureBoundaryViolationReason(
	config: ArchitectureBoundaryConfig | null,
	sourceLayer: string,
	targetLayer: string,
	defaultMessage: string,
): string | null {
	if (config === null || sourceLayer === targetLayer) {
		return null;
	}
	for (let index = 0; index < config.rules.length; index += 1) {
		const rule = config.rules[index];
		if (rule.from === sourceLayer && ruleTargetsLayer(rule, targetLayer)) {
			return formatLayerRuleMessage(rule, sourceLayer, targetLayer, defaultMessage);
		}
	}
	return null;
}

export function relativeArchitectureBoundaryViolationReason(
	config: ArchitectureBoundaryConfig | null,
	sourceLayer: string,
	sourcePath: string,
	relativeTarget: string,
	defaultMessage: string,
): string | null {
	const targetLayer = architectureBoundaryLayer(resolve(dirname(sourcePath), relativeTarget), config);
	return targetLayer === null
		? null
		: architectureBoundaryViolationReason(config, sourceLayer, targetLayer, defaultMessage);
}

function ruleTargetsLayer(rule: ArchitectureBoundaryRule, targetLayer: string): boolean {
	if (rule.except?.includes(targetLayer)) {
		return false;
	}
	if (rule.to === '*') {
		return true;
	}
	return Array.isArray(rule.to) ? rule.to.includes(targetLayer) : rule.to === targetLayer;
}

function formatLayerRuleMessage(rule: ArchitectureBoundaryRule, sourceLayer: string, targetLayer: string, defaultMessage: string): string {
	const template = rule.message ?? defaultMessage;
	return template.replace(/\{from\}/g, sourceLayer).replace(/\{to\}/g, targetLayer);
}
