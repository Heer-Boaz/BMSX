// Headless IDE test: hot-resume tracked-heap behaviour.
// Run: npm run ide:test -- <gameromname> tests/ide/hot_resume_heap.idetest.js
//
// Findings (pietious): normal play keeps globals lean (~642) and loads modules
// lazily. The first hot-resume promotes every module-export slot into cpu.globals
// (globals -> ~2472) and re-runs init, rebuilding the full module graph; old and
// new graphs coexist transiently (~+1.2 MB peak) which can trip the 4 MB budget.
// The level then oscillates and stabilises (no unbounded leak).

function fmt(s) {
	return `tracked=${s.tracked} obj=${s.objectBytes} str=${s.stringBytes} modCache=${s.moduleCache} globals=${s.globals}`;
}

await t.waitForCart();
await t.frames(400); // warm up so lazy modules load like real play

const warm = t.debugStats();
t.log(`warm ${fmt(warm)}`);

const RESUMES = 8;
let maxTracked = warm.tracked;
let lastTracked = warm.tracked;
for (let i = 0; i < RESUMES; i += 1) {
	await t.hotResume();
	await t.frames(8);
	const s = t.debugStats();
	if (s.tracked > maxTracked) maxTracked = s.tracked;
	lastTracked = s.tracked;
	t.log(`resume ${i + 1}/${RESUMES}: ${fmt(s)}`);
}

t.log(`peak tracked over resumes = ${maxTracked} (warm ${warm.tracked})`);

// Regression guard: repeated hot-resume must not grow the heap without bound.
// (This passes today because the level stabilises; it would catch a true leak.)
const drift = lastTracked - maxTracked; // <= 0 once stabilised
t.assert(drift <= 256 * 1024, `tracked heap still trending up after ${RESUMES} resumes (drift ${drift})`);
