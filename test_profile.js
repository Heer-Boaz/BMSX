let current = 0x0200; // 512
let target = 0;
console.log("Profile 3 Deceleration (Neutral):");
for (let i = 1; i <= 300; i++) {
    let delta = target - current;
    let abs_delta = Math.abs(delta);
    let step = Math.floor(abs_delta / 64);
    if (step === 0) {
        current = target;
        console.log(`Step ${i}: SNAPPED TO 0`);
        break;
    }
    current += (delta < 0 ? -step : step);
    if (i % 10 === 0 || i < 10) console.log(`Step ${i}: speed=${current}`);
}
