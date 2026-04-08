let video; 
let bodySegmentation;
let lastMask = null;
let stillStart = null;
let archive;

const STILL_TIME = 5000; // 5 seconds of stillness before stamping
const MOVE_THRESHOLD = 0.05; // Raised for stability

// Top-level settings to make appearance configurable
const settings = {
  // backgroundColor: any CSS color string or null/'transparent' to keep canvas transparent
  backgroundColor: 'transparent',

  // camera: capture still runs but drawing can be toggled
  showCamera: true,
  cameraOpacity: 0.24,

  // person / stamp appearance (used when stamping outlines)
  personFillColor: '#6c6c6cff',
  personFillAlpha: 1.0,
  personBorderColor: '#6c6c6cff',
  personBorderWeight: 2,
  personBorderBlur: 16, // haziness for the border (0 = crisp)
  // Video capture / placement (for preserving aspect ratio)
  videoCaptureWidth: 320,
  videoCaptureHeight: 240,
  videoFit: 'contain', // 'contain' | 'cover' | 'stretch'
  videoScale: 1.0,
  videoOffsetX: 0,
  videoOffsetY: 0,
  videoMirror: true,
};

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);

  // video = createCapture({ video: { width: 1280, height: 720 } });
  // video = createCapture(VIDEO);
  // video.size(320, 240);
  video = createCapture(VIDEO);
video.size(1280, 720);
  video.hide();

  archive = createGraphics(width, height);
  archive.clear();

  // Use 'body-pix' or 'selfie-segmentation' - both work under bodySegmentation
  bodySegmentation = ml5.bodySegmentation(video, { maskType: "background" }, modelReady);
}

// Compute where to draw the video on the canvas while preserving aspect ratio
function computeVideoPlacement() {
  // intrinsic video size (prefer actual camera dimensions when available)
  let vw = settings.videoCaptureWidth;
  let vh = settings.videoCaptureHeight;
  if (video && video.elt) {
    const iw = video.elt.videoWidth || video.elt.width || 0;
    const ih = video.elt.videoHeight || video.elt.height || 0;
    if (iw > 0 && ih > 0) {
      vw = iw;
      vh = ih;
    }
  }

  const cw = width;
  const ch = height;

  if (settings.videoFit === 'stretch') {
    const dw = cw * settings.videoScale;
    const dh = ch * settings.videoScale;
    const dx = (cw - dw) / 2 + settings.videoOffsetX;
    const dy = (ch - dh) / 2 + settings.videoOffsetY;
    return { dx, dy, dw, dh };
  }

  const scaleContain = Math.min(cw / vw, ch / vh);
  const scaleCover = Math.max(cw / vw, ch / vh);
  const baseScale = settings.videoFit === 'cover' ? scaleCover : scaleContain;

  const dw = vw * baseScale * settings.videoScale;
  const dh = vh * baseScale * settings.videoScale;
  const dx = (cw - dw) / 2 + settings.videoOffsetX;
  const dy = (ch - dh) / 2 + settings.videoOffsetY;
  return { dx, dy, dw, dh };
}

function keyPressed() {
  // Nudge offsets
  const step = keyIsDown(SHIFT) ? 10 : 2;
  if (key === 'ArrowLeft') settings.videoOffsetX -= step;
  if (key === 'ArrowRight') settings.videoOffsetX += step;
  if (key === 'ArrowUp') settings.videoOffsetY -= step;
  if (key === 'ArrowDown') settings.videoOffsetY += step;

  // Zoom +/- keys
  if (key === '=') settings.videoScale *= 1.02; // plus
  if (key === '-') settings.videoScale /= 1.02; // minus

  // Toggles
  if (key.toLowerCase() === 'm') settings.videoMirror = !settings.videoMirror;
  if (key.toLowerCase() === 'c') settings.showCamera = !settings.showCamera;

  // Print debug
  if (key.toLowerCase() === 'd') {
    const vp = computeVideoPlacement();
    console.log('videoScale', settings.videoScale, 'offsetX', settings.videoOffsetX, 'offsetY', settings.videoOffsetY);
    console.log('vp', vp, 'intrinsic', video && video.elt ? { w: video.elt.videoWidth, h: video.elt.videoHeight } : null);
  }
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
        // pass the mask image dimensions through so stamping uses the mask's actual size
        // result.mask was the image used to build `mask` earlier; we can use maskImg.width/height
        stampOutline(mask, maskImg.width, maskImg.height);
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

function stampOutline(mask, w, h) {
  console.log(`STAMPING NOW! (stamp size: ${w} x ${h})`);
  // w and h are the actual mask/image dimensions provided by the segmentation result
  // they replace previously hardcoded or settings-based sizes so stamping scales correctly

  // Create an image representing the silhouette fill and the outline separately
  let silhouette = createImage(w, h);
  let outline = createImage(w, h);
  silhouette.loadPixels();
  outline.loadPixels();

  // Build silhouette and outline (white pixels)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let i = x + y * w;
      let px = 4 * i;

      if (mask[i] === 1) {
        // mark silhouette pixel (fully opaque)
        silhouette.pixels[px] = 255;
        silhouette.pixels[px + 1] = 255;
        silhouette.pixels[px + 2] = 255;
        silhouette.pixels[px + 3] = 255;

        // outline: check neighbors to see if boundary
        if (mask[i - 1] === 0 || mask[i + 1] === 0 || mask[i - w] === 0 || mask[i + w] === 0) {
          outline.pixels[px] = 255;
          outline.pixels[px + 1] = 255;
          outline.pixels[px + 2] = 255;
          outline.pixels[px + 3] = 255;
        }
      } else {
        // background: transparent
        silhouette.pixels[px + 3] = 0;
        outline.pixels[px + 3] = 0;
      }
    }
  }

  silhouette.updatePixels();
  outline.updatePixels();

  // Draw into the archive using the same placement rect as the video so stamps align correctly
  const vp = computeVideoPlacement();
  archive.push();
  // Convert outline image to an offscreen canvas draw to leverage shadowBlur
  // We'll draw the outline image at full size, tint it to the border color, and apply shadow on the archive's drawingContext.
  archive.imageMode(CORNER);

  // Prepare 2D context
  let ctx = archive.drawingContext;
  ctx.save();

  // Set shadow (haziness) for the border
  ctx.shadowBlur = settings.personBorderBlur;
  ctx.shadowColor = settings.personBorderColor;

  // Draw outline image tinted to border color
  // To tint, we'll draw the outline image to an offscreen p5.Graphics then color it.
  let outlineGraphics = createGraphics(w, h);
  outlineGraphics.clear();
  outlineGraphics.image(outline, 0, 0, w, h);
  outlineGraphics.loadPixels();
  // Replace white pixels with desired border color (keeping alpha)
  let bc = color(settings.personBorderColor);
  let br = red(bc), bg = green(bc), bb = blue(bc);
  for (let i = 0; i < outlineGraphics.pixels.length; i += 4) {
    if (outlineGraphics.pixels[i + 3] > 0) {
      outlineGraphics.pixels[i] = br;
      outlineGraphics.pixels[i + 1] = bg;
      outlineGraphics.pixels[i + 2] = bb;
      outlineGraphics.pixels[i + 3] = 255;
    }
  }
  outlineGraphics.updatePixels();

  // Draw the tinted outline into the archive, scaled to the video placement rect
  if (settings.videoMirror) {
    // draw mirrored into the video rect
    archive.push();
    archive.translate(vp.dx + vp.dw, vp.dy);
    archive.scale(-1, 1);
    archive.image(outlineGraphics, 0, 0, vp.dw, vp.dh);
    archive.pop();
  } else {
    archive.image(outlineGraphics, vp.dx, vp.dy, vp.dw, vp.dh);
  }

  ctx.restore();
  archive.pop();

  // 2) Draw silhouette fill with specified color and alpha
  archive.push();
  // Use createGraphics to color the silhouette as fill
  let fillGraphics = createGraphics(w, h);
  fillGraphics.clear();
  fillGraphics.image(silhouette, 0, 0, w, h);
  fillGraphics.loadPixels();
  let fc = color(settings.personFillColor);
  let fr = red(fc), fg = green(fc), fb = blue(fc);
  let alpha255 = constrain(settings.personFillAlpha, 0, 1) * 255;
  for (let i = 0; i < fillGraphics.pixels.length; i += 4) {
    if (fillGraphics.pixels[i + 3] > 0) {
      fillGraphics.pixels[i] = fr;
      fillGraphics.pixels[i + 1] = fg;
      fillGraphics.pixels[i + 2] = fb;
      fillGraphics.pixels[i + 3] = alpha255;
    }
  }
  fillGraphics.updatePixels();

  // Draw fill into the archive at the same video placement rect
  if (settings.videoMirror) {
    archive.push();
    archive.translate(vp.dx + vp.dw, vp.dy);
    archive.scale(-1, 1);
    archive.image(fillGraphics, 0, 0, vp.dw, vp.dh);
    archive.pop();
  } else {
    archive.image(fillGraphics, vp.dx, vp.dy, vp.dw, vp.dh);
  }
  archive.pop();

  archive.pop();
}

function draw() {
  // Background handling: preserve transparency if settings.backgroundColor is null or 'transparent'
  if (settings.backgroundColor === null || settings.backgroundColor === 'transparent') {
    clear();
  } else {
    background(settings.backgroundColor);
  }

  // Optionally draw the live video feed faintly (video capture still runs)
  if (settings.showCamera) {
    const vp = computeVideoPlacement();
    push();
    tint(255, constrain(settings.cameraOpacity, 0, 1) * 255);
    if (settings.videoMirror) {
      // mirror only the video rectangle so aspect ratio is preserved
      translate(vp.dx + vp.dw, vp.dy);
      scale(-1, 1);
      image(video, 0, 0, vp.dw, vp.dh);
    } else {
      image(video, vp.dx, vp.dy, vp.dw, vp.dh);
    }
    pop();
  }

  // Show the archive (stamped outlines)
  image(archive, 0, 0);
}

function windowResized() {
  // Preserve existing archive content across resize by copying previous buffer into new one
  const oldArchiveImg = archive ? archive.get() : null;
  resizeCanvas(windowWidth, windowHeight);
  archive = createGraphics(width, height);
  archive.clear();
  if (oldArchiveImg) {
    archive.push();
    archive.image(oldArchiveImg, 0, 0, archive.width, archive.height);
    archive.pop();
  }
  if (video) {
    video.size(settings.videoCaptureWidth, settings.videoCaptureHeight);
  }
}