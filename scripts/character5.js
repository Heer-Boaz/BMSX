const { createCanvas } = require('canvas');

// function drawChest(gender, age, x, y, width, height, ctx) {
//     const isMale = gender === 'male';
//     const chestHeight = isMale ? height * 0.4 : height * 0.5;
//     const chestWidth = isMale ? width * 0.5 : width * 0.4;

//     // Calculate breast shape for female characters
//     if (!isMale) {
//         const breastWidth = chestWidth * 0.7;
//         const breastHeight = chestHeight * 0.5;
//         const breastX = x + chestWidth / 2 - breastWidth / 2;
//         const breastY = y + chestHeight / 4;

//         ctx.fillStyle = '#ff0000';
//         ctx.strokeStyle = '#ff0000';
//         ctx.lineWidth = 1;
//         ctx.beginPath();
//         ctx.ellipse(breastX, breastY, breastWidth / 2, breastHeight / 2, 0, 0, Math.PI * 2);
//         ctx.stroke();
//     }

//     // Draw chest
//     const chestX = x + width / 2 - chestWidth / 2;
//     const chestY = y + height * 0.25;
//     ctx.strokeRect(chestX, chestY, chestWidth, chestHeight);
// }

const canvas = createCanvas(32, 32);

const ctx = canvas.getContext('2d');
ctx.fillStyle = '#ff0000'; // Fill color for male character

const width = 10;
const height = 16;
const upperCurve = 0.5;
const lowerCurve = 0.2;
const curveCenter = 0.6;
const curveWidth = 0.4;

// Draw male chest shape
for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
        const xNorm = x / width;
        const yNorm = y / height;
        const curve = Math.pow(Math.abs(xNorm - curveCenter) / curveWidth, upperCurve) * lowerCurve;
        if (yNorm < curve) {
            ctx.fillRect(x, y, 1, 1);
        }
    }
}

ctx.fillStyle = '#00ff00'; // Fill color for female character

// Draw female chest shape
const breastWidth = 2;
const breastHeight = 1.5;
const breastOffset = 1;
const breastCurve = 0.6;
const breastPos = [width / 2 - breastWidth / 2, breastOffset];
for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
        const xNorm = x / width;
        const yNorm = y / height;
        const curve = Math.pow(Math.abs(xNorm - curveCenter) / curveWidth, upperCurve) * lowerCurve;
        if (yNorm < curve) {
            const inBreastArea = x >= breastPos[0] && x < breastPos[0] + breastWidth &&
                y >= breastPos[1] && y < breastPos[1] + breastHeight;
            if (inBreastArea) {
                const breastYNorm = (y - breastPos[1]) / breastHeight;
                const breastCurveVal = Math.pow(Math.abs(xNorm - 0.5) / breastCurve, 2);
                const breastCurveTop = curve * (1 - breastCurveVal);
                if (yNorm < breastCurveTop + breastYNorm * (1 - breastCurveTop)) {
                    ctx.fillRect(x, y, 1, 1);
                }
            } else {
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }
}


function hexToRgb(hex) {
    const r = parseInt(hex.substring(1, 3), 16);
    const g = parseInt(hex.substring(3, 5), 16);
    const b = parseInt(hex.substring(5, 7), 16);
    return [r, g, b];
}

function getAnsiColors(r, g, b, isForeground) {
    // ANSI black and white
    if (r === g && g === b) {
        return isForeground ? '37' : '40';
    }

    // ANSI color palette
    const palette = [
        [0, 0, 0],
        [205, 0, 0],
        [0, 205, 0],
        [205, 205, 0],
        [0, 0, 238],
        [205, 0, 205],
        [0, 205, 205],
        [229, 229, 229],
        [127, 127, 127],
        [255, 0, 0],
        [0, 255, 0],
        [255, 255, 0],
        [92, 92, 255],
        [255, 0, 255],
        [0, 255, 255],
        [255, 255, 255]
    ];

    // Find the closest ANSI color
    let closestDistance = Infinity;
    let closestColor = isForeground ? '37' : '40';
    for (let i = 0; i < palette.length; i++) {
        const [pr, pg, pb] = palette[i];
        const distance = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
        if (distance < closestDistance) {
            closestDistance = distance;
            closestColor = isForeground ? ANSI_FOREGROUND[i] : ANSI_BACKGROUND[i];
        }
    }

    return closestColor;
}

function toAscii(pixelData, width, height) {
    let ascii = '';

    for (let y = 0; y < height; y++) {
        let row = '';

        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const r = pixelData[i];
            const g = pixelData[i + 1];
            const b = pixelData[i + 2];
            const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            // const char = gray < 128 ? '█' : ' ';
            const ansiColor = getAnsiColors(r, g, b, gray >= 128);
            row += (`\x1b[${ansiColor}m█\x1b[0m`);
        }

        ascii += row;
    }
    return ascii;
    // return ascii.join('\n');
}

// Example usage
// const canvas = createCanvas(16, 32);
// const ctx = canvas.getContext('2d');

// Draw an adult male chest
// drawChest('male', 'adult', 50, 50, 20, 40, ctx);
// console.log(toAscii(ctx.getImageData(0, 0, 16, 32).data, 16, 32));
console.log(toAscii(ctx.getImageData(0, 0, 32, 32).data, 32, 32));

// Draw an adult female chest
// drawChest('female', 'adult', 100, 50, 30, 60, ctx);
