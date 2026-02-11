import fs from 'node:fs';

const logPath = process.argv[2];
if (!logPath) {
	throw new Error('Usage: node src/carts/esther/test/analyze_esther_render_diff.mjs <headless-log-path>');
}

const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/);

const markerScenarioRe = /\[marker\] scenario=([a-z_]+)/;
const markerTimeRe = /\[marker\] t=(\d+)/;
const spriteRe = /^\s+\+\s+\[sprite#\d+\] id=(esther_dk_[^ ]+)\s+layer=[^ ]+\s+pos=\(([-0-9.]+),\s+([-0-9.]+),\s+([-0-9.]+)\)/;

let scenario = 'unknown';
const markers = [];
const points = [];

for (let i = 0; i < lines.length; i += 1) {
	const line = lines[i];
	const lineNo = i + 1;

	const scenarioMatch = markerScenarioRe.exec(line);
	if (scenarioMatch) {
		scenario = scenarioMatch[1];
	}

	const markerMatch = markerTimeRe.exec(line);
	if (markerMatch) {
		markers.push({
			lineNo,
			timeMs: Number(markerMatch[1]),
		});
	}

	const spriteMatch = spriteRe.exec(line);
	if (spriteMatch) {
		points.push({
			lineNo,
			id: spriteMatch[1],
			x: Number(spriteMatch[2]),
			y: Number(spriteMatch[3]),
			z: Number(spriteMatch[4]),
		});
	}
}

if (points.length === 0) {
	throw new Error(`No esther_dk sprite lines found in ${logPath}`);
}

function pointBeforeLine(lineNo) {
	let result = null;
	for (let i = 0; i < points.length; i += 1) {
		if (points[i].lineNo <= lineNo) {
			result = points[i];
		} else {
			break;
		}
	}
	return result;
}

function pointAfterLine(lineNo) {
	for (let i = 0; i < points.length; i += 1) {
		if (points[i].lineNo > lineNo) {
			return points[i];
		}
	}
	return null;
}

function pointsBetweenLines(startLineNo, endLineNo) {
	return points.filter((point) => point.lineNo > startLineNo && point.lineNo <= endLineNo);
}

function markerLineByTime(timeMs) {
	const marker = markers.find((entry) => entry.timeMs === timeMs);
	return marker ? marker.lineNo : null;
}

const first = points[0];
const last = points[points.length - 1];
const summary = {
	scenario,
	logPath,
	pointCount: points.length,
	firstPoint: first,
	lastPoint: last,
	markers,
	metrics: {},
};

if (scenario === 'stop') {
	const releaseLine = markerLineByTime(3000);
	const probeLine = markerLineByTime(9000);
	if (releaseLine && probeLine) {
		const atRelease = pointAfterLine(releaseLine);
		const atProbe = pointBeforeLine(probeLine);
		if (atRelease && atProbe) {
			summary.metrics.stopDriftX = Number((atProbe.x - atRelease.x).toFixed(3));
			summary.metrics.stopReleaseSprite = atRelease.id;
			summary.metrics.stopProbeSprite = atProbe.id;
		}
	}
}

if (scenario === 'stand_jump' || scenario === 'run_jump') {
	const jumpPressLine = markerLineByTime(scenario === 'stand_jump' ? 2500 : 2900);
	const probeLine = markerLineByTime(9000);
	if (jumpPressLine && probeLine) {
		const beforeJump = pointBeforeLine(jumpPressLine);
		const window = pointsBetweenLines(jumpPressLine, probeLine);
		if (beforeJump && window.length > 0) {
			let apex = window[0];
			for (let i = 1; i < window.length; i += 1) {
				if (window[i].y < apex.y) {
					apex = window[i];
				}
			}
			summary.metrics.jumpBaseY = beforeJump.y;
			summary.metrics.jumpApexY = apex.y;
			summary.metrics.jumpHeight = Number((beforeJump.y - apex.y).toFixed(3));
			summary.metrics.jumpApexSprite = apex.id;
		}
	}
}

if (scenario === 'direction_release_jump_hold') {
	const jumpPressLine = markerLineByTime(2900);
	const probeLine = markerLineByTime(9000);
	if (jumpPressLine && probeLine) {
		const beforeJump = pointBeforeLine(jumpPressLine);
		const window = pointsBetweenLines(jumpPressLine, probeLine);
		if (beforeJump && window.length > 0) {
			const baselineY = beforeJump.y;
			let wasAirborne = false;
			let airbornePhases = 0;
			let minY = baselineY;
			for (let i = 0; i < window.length; i += 1) {
				const y = window[i].y;
				if (y < minY) {
					minY = y;
				}
				const airborne = y < baselineY - 0.5;
				if (!wasAirborne && airborne) {
					airbornePhases += 1;
				}
				wasAirborne = airborne;
			}
			summary.metrics.jumpBaseY = baselineY;
			summary.metrics.jumpApexY = minY;
			summary.metrics.jumpHeight = Number((baselineY - minY).toFixed(3));
			summary.metrics.airbornePhases = airbornePhases;
		}
	}
}

console.log(JSON.stringify(summary, null, 2));
