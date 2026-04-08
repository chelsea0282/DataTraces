let video; 
let bodySegmentation;
let lastMask = null;
let stillStart = null;
let archive;

const STILL_TIME = 5000; 
const MOVE_THRESHOLD = 0.05; // Raised for stability

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);

  video = createCapture(VIDEO);
  video.size(320, 240);
  video.hide();

  archive = createGraphics(width, height);
  archive.clear();

  // Use 'body-pix' or 'selfie-segmentation' - both work under bodySegmentation
  bodySegmentation = ml5.bodySegmentation(video, { maskType: "background" }, modelReady);
}

function modelReady() {
  console.log("Model Loaded!");
  bodySegmentation.detectStart(video, gotResults);
}

function gotResults(result) {
  if (!result || !result.mask) return;

  let maskImg = result.mask;
  let mask = imageToBinary(maskImg);

  // --- DEBUGGING: UNCOMMENT THE LINE BELOW TO SEE THE RAW MASK ---
  // image(maskImg, 0, 0, 160, 120); 

  if (lastMask) {
    let diff = maskDiff(mask, lastMask);

    if (diff < MOVE_THRESHOLD) {
      if (!stillStart) stillStart = millis();

      if (millis() - stillStart > STILL_TIME) {
        stampOutline(mask);
        stillStart = null;
      }
    } else {
      stillStart = null;
    }
  }

  // Use a proper copy of the array
  lastMask = new Int8Array(mask);
}

function imageToBinary(img) {
  img.loadPixels();
  let arr = new Int8Array(img.width * img.height);

  for (let i = 0; i < img.pixels.length; i += 4) {
    // ROBUST CHECK: ml5 v1.0 usually marks the person as WHITE (255, 255, 255)
    // or checks the Alpha channel. We'll check if ANY channel is active.
    let r = img.pixels[i];
    let a = img.pixels[i + 3];
    
    // If it's bright OR opaque, it's likely the person
    arr[i / 4] = (r > 127 || a > 127) ? 1 : 0;
  }
  return arr;
}

function maskDiff(a, b) {
  let d = 0;
  // Speed up check by sampling every 2nd pixel
  for (let i = 0; i < a.length; i += 2) {
    if (a[i] !== b[i]) d++;
  }
  return d / (a.length / 2);
}

function stampOutline(mask) {
  console.log("STAMPING NOW!");
  let w = 320;
  let h = 240;

  let img = createImage(w, h);
  img.loadPixels();

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let i = x + y * w;

      if (mask[i] === 1) {
        // Look for boundaries between 1 (person) and 0 (background)
        if (mask[i - 1] === 0 || mask[i + 1] === 0 || mask[i - w] === 0 || mask[i + w] === 0) {
          let px = 4 * i;
          img.pixels[px] = 255;
          img.pixels[px + 1] = 255;
          img.pixels[px + 2] = 255;
          img.pixels[px + 3] = 255; 
        }
      }
    }
  }

  img.updatePixels();
  
  // Flip the image manually before drawing to archive to match mirrored view
  archive.push();
  archive.translate(width, 0);
  archive.scale(-1, 1);
  archive.image(img, 0, 0, width, height);
  archive.pop();
}

function draw() {
  background(0);
  
  // Faint live video preview
  push();
  translate(width, 0);
  scale(-1, 1);
  tint(255, 60); 
  image(video, 0, 0, width, height);
  pop();

  // Show the archive
  image(archive, 0, 0);
}