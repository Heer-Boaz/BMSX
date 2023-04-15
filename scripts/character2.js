class BodyPart {
    constructor(width, height, fillColor, strokeColor, strokeWidth, shapes) {
        this.width = width;
        this.height = height;
        this.fillColor = fillColor;
        this.strokeColor = strokeColor;
        this.strokeWidth = strokeWidth;
        this.shapes = shapes;
    }

    draw() {
        let pixels = '';

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                let color = this.strokeColor;
                let isInsideShape = false;

                for (let i = 0; i < this.shapes.length; i++) {
                    const shape = this.shapes[i];

                    if (shape.type === 'rectangle') {
                        const [sx, sy] = shape.position;
                        const [sw, sh] = shape.size;
                        const angle = shape.rotation * Math.PI / 180;
                        const cos = Math.cos(angle);
                        const sin = Math.sin(angle);

                        const tx = x - sx - sw / 2;
                        const ty = y - sy - sh / 2;

                        const rx = cos * tx - sin * ty;
                        const ry = sin * tx + cos * ty;

                        if (rx >= -sw / 2 && rx < sw / 2 && ry >= -sh / 2 && ry < sh / 2) {
                            color = shape.color || this.fillColor;
                            isInsideShape = true;
                            break;
                        }
                    } else if (shape.type === 'circle') {
                        const [cx, cy] = shape.position;
                        const r = shape.radius;
                        const dx = x - cx;
                        const dy = y - cy;
                        if (dx * dx + dy * dy < r * r) {
                            color = shape.color || this.fillColor;
                            isInsideShape = true;
                            break;
                        }
                    }
                }

                if (!isInsideShape) {
                    color = this.strokeColor;
                }

                const [r, g, b] = hexToRgb(color);
                const ansiColor = getAnsiColors(r, g, b, color === this.fillColor);

                pixels += `\x1b[${ansiColor}m█\x1b[0m`;
            }
            pixels += '\n';
        }

        console.log(pixels);
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


// Shape rule generators
const rectangle = (position, size, color, rotation = 0) => ({ type: 'rectangle', position, size, color, rotation });
const circle = (position, radius, color, rotation = 0) => ({ type: 'circle', position, radius, color, rotation });

const leftArmShapeRules = [rectangle([0, 0], [3, 10], '#c0c0c0', -30),
rectangle([1, 3], [1, 4], '#ffffff', -30),
rectangle([0, 2], [1, 6], '#c0c0c0', -30),
rectangle([0, 1], [1, 1], '#ffffff', -30),
rectangle([0, 8], [1, 1], '#ffffff', -30)
];

const leftArmShapeGenerator = (color, outlineColor, outlineThickness) => [...leftArmShapeRules, outlineColor ? rectangle([0, 0], [3, 10], outlineColor, -30) : null
].filter(rule => rule !== null);

const rightArmShapeRules = [rectangle([0, 0], [3, 10], '#c0c0c0', 30),
rectangle([1, 3], [1, 4], '#ffffff', 30),
rectangle([2, 2], [1, 6], '#c0c0c0', 30),
rectangle([2, 1], [1, 1], '#ffffff', 30),
rectangle([2, 8], [1, 1], '#ffffff', 30)
];

const rightArmShapeGenerator = (color, outlineColor, outlineThickness) => [...rightArmShapeRules, outlineColor ? rectangle([0, 0], [3, 10], outlineColor, 30) : null
].filter(rule => rule !== null);

// const body = new BodyPart(8, 12, '#aa0000', '#000000', 1, bodyShapeGenerator('#c0c0c0', '#000000', 1));

const leftArm = new BodyPart(3, 10, '#c0c0c0', '#000000', 1, leftArmShapeGenerator('#c0c0c0', '#000000', 1));
const rightArm = new BodyPart(3, 10, '#c0c0c0', '#000000', 1, rightArmShapeGenerator('#c0c0c0', '#000000', 1));

for (let i = 0; i < 10; i++) {
    // Create body
    // body.shapes = bodyShapeGenerator('#c0c0c0', '#000000', 1);
    // body.draw();

    // Create left arm
    leftArm.shapes = leftArmShapeGenerator('#c0c0c0', '#000000', 1);
    leftArm.shapes[0].position[1] = 3 + Math.floor(Math.sin(i * 0.3) * 2);
    leftArm.shapes[1].position[1] = 3 + Math.floor(Math.sin(i * 0.3 + Math.PI) * 2);
    leftArm.draw();

    // Create right arm
    rightArm.shapes = rightArmShapeGenerator('#c0c0c0', '#000000', 1);
    rightArm.shapes[0].position[1] = 3 + Math.floor(Math.sin(i * 0.3 + Math.PI) * 2);
    rightArm.shapes[1].position[1] = 3 + Math.floor(Math.sin(i * 0.3) * 2);
    rightArm.draw();

}
