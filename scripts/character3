const { createCanvas } = require('canvas');

class BodyPart {
    constructor(canvas, fillColor, strokeColor, strokeWidth, shapes) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.fillColor = fillColor;
        this.strokeColor = strokeColor;
        this.strokeWidth = strokeWidth;
        this.shapes = shapes;
        this.width = canvas.width;
        this.height = canvas.height;
    }

    draw() {
        // Clear the canvas
        this.ctx.clearRect(0, 0, this.width, this.height);

        // Draw the shapes
        this.ctx.fillStyle = this.fillColor;
        this.ctx.strokeStyle = this.strokeColor;
        this.ctx.lineWidth = this.strokeWidth;

        for (let i = 0; i < this.shapes.length; i++) {
            const shape = this.shapes[i];

            if (shape.type === 'rectangle') {
                const [x, y] = shape.position;
                const [w, h] = shape.size;
                const angle = shape.rotation * Math.PI / 180;

                this.ctx.save();
                this.ctx.translate(x + w / 2, y + h / 2);
                this.ctx.rotate(angle);
                this.ctx.fillRect(-w / 2, -h / 2, w, h);
                this.ctx.strokeRect(-w / 2, -h / 2, w, h);
                this.ctx.restore();
            } else if (shape.type === 'circle') {
                const [x, y] = shape.position;
                const r = shape.radius;

                this.ctx.beginPath();
                this.ctx.arc(x, y, r, 0, 2 * Math.PI);
                this.ctx.fill();
                this.ctx.stroke();
            }
        }
    }

    getPixelData() {
        return this.ctx.getImageData(0, 0, this.width, this.height).data;
    }
}

function toAscii(pixelData, width, height) {
    const ascii = [];

    for (let y = 0; y < height; y++) {
        const row = [];

        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const r = pixelData[i];
            const g = pixelData[i + 1];
            const b = pixelData[i + 2];
            const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const char = gray < 128 ? '█' : ' ';
            row.push(char);
        }

        ascii.push(row.join(''));
    }

    return ascii.join('\n');
}

// Shape rule generators
const rectangle = (position, size, color, rotation = 0) => ({ type: 'rectangle', position, size, color, rotation });
const circle = (position, radius, color, rotation = 0) => ({ type: 'circle', position, radius, color, rotation });

const bodyShapeGenerator = (color, outlineColor, outlineThickness) => [
    rectangle([0, 0], [8, 12], color),
    rectangle([1, 0], [6, 8], '#ffffff'),
    rectangle([2, 8], [4, 4], '#000000'),
    outlineThickness > 0 ? rectangle([0, 0], [8, 12], outlineColor) : null
].filter(rule => rule !== null);

const leftArmShapeGenerator = (color, outlineColor, outlineThickness) => [
    rectangle([0, 0], [4, 12], color),
    rectangle([1, 11], [2, 1], '#000000'),
    outlineThickness > 0 ? rectangle([0, 0], [4, 12], outlineColor) : null
].filter(rule => rule !== null);

const rightArmShapeGenerator = (color, outlineColor, outlineThickness) => [
    rectangle([4, 0], [4, 12], color),
    rectangle([5, 11], [2, 1], '#000000'),
    outlineThickness > 0 ? rectangle([4, 0], [4, 12], outlineColor) : null
].filter(rule => rule !== null);

const legShapeGenerator = (color, outlineColor, outlineThickness) => [
    rectangle([1, 12], [2, 8], color),
    rectangle([2, 19], [1, 1], '#000000'),
    rectangle([4, 12], [2, 8], color),
    rectangle([5, 19], [1, 1], '#000000'),
    outlineThickness > 0 ? rectangle([1, 12], [2, 8], outlineColor) : null,
    outlineThickness > 0 ? rectangle([4, 12], [2, 8], outlineColor) : null
].filter(rule => rule !== null);

class Sprite {
    constructor(canvas, bodyColor, limbColor, outlineColor, outlineThickness) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.bodyColor = bodyColor;
        this.limbColor = limbColor;
        this.outlineColor = outlineColor;
        this.outlineThickness = outlineThickness;
        this.body = new BodyPart(canvas, bodyColor, outlineColor, outlineThickness, bodyShapeGenerator(bodyColor, outlineColor, outlineThickness));
        this.leftArm = new BodyPart(canvas, limbColor, outlineColor, outlineThickness, leftArmShapeGenerator(limbColor, outlineColor, outlineThickness));
        this.rightArm = new BodyPart(canvas, limbColor, outlineColor, outlineThickness, rightArmShapeGenerator(limbColor, outlineColor, outlineThickness));
        this.leftLeg = new BodyPart(canvas, limbColor, outlineColor, outlineThickness, legShapeGenerator(limbColor, outlineColor, outlineThickness));
        this.rightLeg = new BodyPart(canvas, limbColor, outlineColor, outlineThickness, legShapeGenerator(limbColor, outlineColor, outlineThickness));
    }

    draw(x, y, leftArmAngle, rightArmAngle, leftLegAngle, rightLegAngle) {
        this.body.draw();
        this.ctx.save();
        this.ctx.translate(x + 2, y + 2);
        this.ctx.rotate(leftArmAngle * Math.PI / 180);
        this.leftArm.draw();
        this.ctx.restore();

        this.ctx.save();
        this.ctx.translate(x + 6, y + 2);
        this.ctx.rotate(rightArmAngle * Math.PI / 180);
        this.rightArm.draw();
        this.ctx.restore();

        this.ctx.save();
        this.ctx.translate(x + 2, y + 20);
        this.ctx.rotate(leftLegAngle * Math.PI / 180);
        this.leftLeg.draw();
        this.ctx.restore();

        this.ctx.save();
        this.ctx.translate(x + 5, y + 20);
        this.ctx.rotate(rightLegAngle * Math.PI / 180);
        this.rightLeg.draw();
        this.ctx.restore();
    }

    toAscii() {
        const pixelData = this.body.getPixelData();
        return toAscii(pixelData, 16, 32);
    }
}

const canvas = createCanvas(16, 32);
const sprite = new Sprite(canvas, '#ff0000', '#00ff00', '#000000', 2);

console.log(sprite.toAscii());
