#!/usr/bin/env node
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const candidates = [
	'microsoft-edge',
	'microsoft-edge-stable',
	'edge',
	'google-chrome',
	'chrome',
	'chromium',
	'chromium-browser'
];

function which(cmd) {
	try {
		const out = execSync(`which ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
		return out || null;
	} catch (e) {
		return null;
	}
}

const found = candidates.map(c => which(c)).find(Boolean) || null;
const launchPath = path.join(__dirname, '..', '.vscode', 'launch.json');
if (!fs.existsSync(launchPath)) {
	console.error('No .vscode/launch.json found at', launchPath);
	process.exit(2);
}

const raw = fs.readFileSync(launchPath, 'utf8');
let jsonText = raw;
if (found) {
	console.log('Detected browser:', found);
	// Replace any runtimeExecutable entries value with the found executable name (basename)
	const exeBasename = path.basename(found);
	jsonText = jsonText.replace(/"runtimeExecutable"\s*:\s*"[^"]*"/g, `"runtimeExecutable": "${exeBasename}"`);
} else {
	console.log('No known browser executable detected on PATH. Will not modify runtimeExecutable.');
}

// write back only if changed
if (jsonText !== raw) {
	fs.writeFileSync(launchPath, jsonText, 'utf8');
	console.log('Updated', launchPath);
} else {
	console.log('No changes made to', launchPath);
}

process.exit(0);
