function draw() {
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

function drawMaleChest(width, height) {
  const chestHeight = height * 0.28;
  const chestWidth = width * 0.3;
  const chestX = (width - chestWidth) / 2;
  const chestY = height * 0.2;

  const breastX = chestX + chestWidth * 0.4;
  const breastY = chestY + chestHeight * 0.4;
  const breastWidth = chestWidth * 0.2;
  const breastHeight = chestHeight * 0.2;

  const bellyWidth = chestWidth * 0.8;
  const bellyHeight = chestHeight * 0.6;
  const bellyX = chestX + (chestWidth - bellyWidth) / 2;
  const bellyY = chestY + chestHeight * 0.4;

  const chest = {
    type: 'rectangle',
    position: [chestX, chestY],
    size: [chestWidth, chestHeight],
    color: '#8b4513'
  };

  const breast = {
    type: 'rectangle',
    position: [breastX, breastY],
    size: [breastWidth, breastHeight],
    color: '#ffb6c1'
  };

  const belly = {
    type: 'rectangle',
    position: [bellyX, bellyY],
    size: [bellyWidth, bellyHeight],
    color: '#8b4513'
  };

  return [chest, breast, belly];
}

// Example usage:
const width = 32;
const height = 64;

const chestShapes = drawMaleChest(width, height);
