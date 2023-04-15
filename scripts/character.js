function createCharacter(targetSize, gender, orientation, perspective) {
  // Determine the basic geometric shapes to use
  let bodyShape, headShape, armShape, legShape, bodyArt, headArt, armArt, legArt;
  if (gender === 'male') {
    bodyShape = 'rectangle';
    headShape = 'circle';
    armShape = 'rectangle';
    legShape = 'triangle';
    bodyArt = ' _____\n|     |\n|     |\n|_____|\n';
    headArt = '  OOO  \n O   O \nO     O\n O   O \n  OOO  \n';
    armArt = '||\n||\n||\n||\n';
    legArt = '   /\\    /\\  \n  /  \\  /  \\ \n /    \\/    \\\n';
  } else {
    bodyShape = 'oval';
    headShape = 'heart';
    armShape = 'oval';
    legShape = 'star';
    bodyArt = '   _____   \n /       \\ \n/         \\\n\\         /\n \\_______/ \n';
    headArt = '  .:~~~:.\n /       \\\n/         \\\n\\         /\n \\       / \n  `:___:\'  \n';
    armArt = '( )\n | \n/ \\\n';
    legArt = '  / \\    / \\  \n (_ _)  (_ _)\n   *      *   \n';
  }

  // Determine the proportions of each body part
  let bodyWidth, bodyHeight, headDiameter, armWidth, armHeight, legTopWidth, legBottomWidth;
  if (orientation === 'side') {
    bodyWidth = 8;
    bodyHeight = 12;
    headDiameter = 6;
    armWidth = 2;
    armHeight = 6;
    legTopWidth = 4;
    legBottomWidth = 2;
  } else {
    bodyWidth = 12;
    bodyHeight = 8;
    headDiameter = 4;
    armWidth = 6;
    armHeight = 2;
    legTopWidth = 2;
    legBottomWidth = 4;
  }

  // Determine the target size of the character
  let width, height;
  if (perspective === 'flat') {
    width = targetSize;
    height = targetSize;
  } else {
    width = targetSize * 1.5;
    height = targetSize;
  }

  // Return the final character object
  return {
    targetSize: targetSize,
    gender: gender,
    orientation: orientation,
    perspective: perspective,
    bodyShape: bodyShape,
    headShape: headShape,
    armShape: armShape,
    legShape: legShape,
    bodyArt: bodyArt,
    headArt: headArt,
    armArt: armArt,
    legArt: legArt,
    bodyWidth: bodyWidth,
    bodyHeight: bodyHeight,
    headDiameter: headDiameter,
    armWidth: armWidth,
    armHeight: armHeight,
    legTopWidth: legTopWidth,
    legBottomWidth: legBottomWidth,
    width: width,
    height: height
  };
}

const character = createCharacter(16, 'male', 'side', 'flat');
console.log(character.headArt);
console.log(character.bodyArt);
console.log(character.armArt);
