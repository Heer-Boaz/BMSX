function to_signed_16(val) {
    val = val & 0xFFFF;
    return (val >= 0x8000) ? (val - 0x10000) : val;
}

let current = 0;
let target = 0x0200; // 512 subpixels

console.log(`Start acceleration: current=${current}, target=${target}`);
for (let i = 1; i <= 10; i++) {
    let delta = target - current;
    let abs_delta = Math.abs(delta);
    let step = Math.floor(abs_delta / 64);
    if (step === 0) current = target;
    else current += step;
    console.log(`Step ${i}: current=${current}`);
}

console.log("\nStart deceleration (Neutral):");
target = 0;
for (let i = 1; i <= 200; i++) {
    let delta = target - current;
    let abs_delta = Math.abs(delta);
    let step = Math.floor(abs_delta / 64);
    if (step === 0) {
        current = target;
        console.log(`Step ${i}: SNAPPED to 0!`);
        break;
    } else {
        current += (delta < 0 ? -step : step);
    }
    if (i % 10 === 0) console.log(`Step ${i}: current=${current}`);
}
