let video; 
let bodySegmentation;
let lastMask = null;
let stillStart = null;
let stamps = []; // pending stamps that are fading in
let archive;
let questions = ["Your data is collected 5000 times a day",
  "",
  "",
]; 
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
  // lighter defaults so stamped silhouettes read as shadows rather than solid black
  personFillColor: '#6c6c6c88',
  personFillAlpha: 0.9,
  // border is a soft, light grey with slight transparency
  personBorderColor: '#6c6c6c88',
  personBorderWeight: 2,
  personBorderBlur: 5, // soft 5px blur for shadow-like edge
  // Video capture / placement (for preserving aspect ratio)
  videoCaptureWidth: 1280,
  videoCaptureHeight: 720,
  // default to 'cover' so the video fills the entire canvas (cropping as needed)
  // ('cover' preserves aspect ratio and crops to fill; 'stretch' will distort)
  videoFit: 'cover', // 'contain' | 'cover' | 'stretch'
  videoScale: 1.0,
  videoOffsetX: 0,
  videoOffsetY: 0,
  videoMirror: false,
  // how long (ms) the stamp fades in after being created
  stampFadeDuration: 5000,
  // how long (ms) to wait AFTER the stamp is created before starting the fade-in
  stampDelay: 5000,
  // allow quickly disabling the pre-fade delay for testing
  stampDelayEnabled: true,
  // morphological opening to remove thin attachments (shadows)
  morphologyEnabled: true,
  morphologyIterations: 1,
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
  if (key.toLowerCase() === 'l') {
    settings.stampDelayEnabled = !settings.stampDelayEnabled;
    console.log('stampDelayEnabled', settings.stampDelayEnabled, 'stampDelay(ms)', settings.stampDelay);
  }

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

// Keep only the most likely person connected component in the binary mask.
// Strategy: find connected components (4-connected), compute each component's
// top-most y (minY) and area, then choose the component with the smallest minY
// (closest to the top of the image) as the person. Returns a new Int8Array mask.
function filterPersonComponent(mask, w, h) {
  const labels = new Int32Array(w * h);
  let label = 1;
  const comps = [];

  const stack = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      if (mask[i] !== 1 || labels[i] !== 0) continue;
      // flood fill
      let area = 0;
      let minY = y;
      stack.push(i);
      labels[i] = label;
      while (stack.length) {
        const idx = stack.pop();
        area++;
        const cx = idx % w;
        const cy = Math.floor(idx / w);
        if (cy < minY) minY = cy;

        // 4-neighbors
        const n1 = idx - 1;
        if (cx > 0 && labels[n1] === 0 && mask[n1] === 1) { labels[n1] = label; stack.push(n1); }
        const n2 = idx + 1;
        if (cx < w - 1 && labels[n2] === 0 && mask[n2] === 1) { labels[n2] = label; stack.push(n2); }
        const n3 = idx - w;
        if (cy > 0 && labels[n3] === 0 && mask[n3] === 1) { labels[n3] = label; stack.push(n3); }
        const n4 = idx + w;
        if (cy < h - 1 && labels[n4] === 0 && mask[n4] === 1) { labels[n4] = label; stack.push(n4); }
      }

      comps.push({ label, area, minY });
      label++;
    }
  }

  if (comps.length === 0) return mask;

  // choose component with smallest minY; tie-breaker: larger area
  comps.sort((a, b) => (a.minY - b.minY) || (b.area - a.area));
  const chosen = comps[0].label;

  const out = new Int8Array(w * h);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === chosen) out[i] = 1;
  }
  return out;
}

function stampOutline(mask, w, h) {
  console.log(`STAMPING NOW! (stamp size: ${w} x ${h})`);
  // w and h are the actual mask/image dimensions provided by the segmentation result
  // they replace previously hardcoded or settings-based sizes so stamping scales correctly
  // Optionally apply a morphological opening (erode then dilate) to remove thin attachments
  // like shadows that are connected to the main component by a narrow bridge.
  if (settings.morphologyEnabled) {
    mask = morphOpen(mask, w, h, settings.morphologyIterations);
  }

  // filter to keep only the most likely person connected component (removes distant blobs)
  mask = filterPersonComponent(mask, w, h);

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
  // Prepare filled silhouette graphics
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

  // Instead of drawing immediately, push a stamp object that will fade in over time
  const stamp = {
    outline: outlineGraphics,
    fill: fillGraphics,
    created: millis(),
    fadeDuration: settings.stampFadeDuration,
    // respect the enabled flag so tests can disable the pre-fade lag
    delay: settings.stampDelayEnabled ? (settings.stampDelay || 0) : 0,
    vp: vp
  };
  stamps.push(stamp);
  archive.pop();
}

// Morphological operations on binary masks (Int8Array of 0/1)
function morphOpen(mask, w, h, iterations) {
  let out = mask;
  for (let i = 0; i < (iterations || 1); i++) {
    out = erodeMask(out, w, h);
  }
  for (let i = 0; i < (iterations || 1); i++) {
    out = dilateMask(out, w, h);
  }
  return out;
}

function erodeMask(mask, w, h) {
  const out = new Int8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let i = x + y * w;
      if (mask[i] !== 1) continue;
      // require full 3x3 neighborhood
      let keep = 1;
      for (let yy = -1; yy <= 1; yy++) {
        for (let xx = -1; xx <= 1; xx++) {
          let j = (x + xx) + (y + yy) * w;
          if (mask[j] !== 1) { keep = 0; break; }
        }
        if (!keep) break;
      }
      out[i] = keep;
    }
  }
  return out;
}

function dilateMask(mask, w, h) {
  const out = new Int8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let i = x + y * w;
      if (mask[i] === 1) {
        // set neighborhood
        for (let yy = -1; yy <= 1; yy++) {
          for (let xx = -1; xx <= 1; xx++) {
            let nx = x + xx;
            let ny = y + yy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              out[nx + ny * w] = 1;
            }
          }
        }
      }
    }
  }
  return out;
}

// Helper: convert a p5 color string into an rgba(...) CSS string for canvas shadowColor
function shadowColorString(cssColor) {
  try {
    const c = color(cssColor);
    const r = floor(red(c));
    const g = floor(green(c));
    const b = floor(blue(c));
    const a = constrain(alpha(c) / 255, 0, 1);
    return `rgba(${r},${g},${b},${a})`;
  } catch (e) {
    return cssColor;
  }
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

  // Show the archive (finished stamps)
  image(archive, 0, 0);

  // Render pending stamps (fade-in). When a stamp finishes fading in, bake it into the archive.
  const now = millis();
  for (let i = stamps.length - 1; i >= 0; i--) {
    const s = stamps[i];
    // Respect an initial delay before starting the fade-in
    const fadeStart = s.created + (s.delay || 0);
    if (now < fadeStart) {
      // Not yet started fading in — skip drawing this stamp for now
      continue;
    }
    const t = (now - fadeStart) / (s.fadeDuration || settings.stampFadeDuration);
    const a = constrain(t, 0, 1);

    // Draw fill first (with alpha) using direct canvas drawImage to avoid p5 tint/transform
    const ctx = drawingContext;
    ctx.save();
    ctx.globalAlpha = a;
    if (settings.videoMirror) {
      ctx.translate(s.vp.dx + s.vp.dw, s.vp.dy);
      ctx.scale(-1, 1);
      ctx.drawImage(s.fill.canvas, 0, 0, s.vp.dw, s.vp.dh);
    } else {
      ctx.drawImage(s.fill.canvas, s.vp.dx, s.vp.dy, s.vp.dw, s.vp.dh);
    }
    ctx.restore();

    // Draw outline with shadow (soft edge). Use a CSS rgba shadow color to preserve alpha.
    const shadowColor = shadowColorString(settings.personBorderColor);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.shadowBlur = settings.personBorderBlur;
    ctx.shadowColor = shadowColor;
    if (settings.videoMirror) {
      ctx.translate(s.vp.dx + s.vp.dw, s.vp.dy);
      ctx.scale(-1, 1);
      ctx.drawImage(s.outline.canvas, 0, 0, s.vp.dw, s.vp.dh);
    } else {
      ctx.drawImage(s.outline.canvas, s.vp.dx, s.vp.dy, s.vp.dw, s.vp.dh);
    }
    ctx.restore();

    // If fully faded in, bake into archive and remove from pending stamps
    if (a >= 1) {
      // draw permanently into archive using canvas drawImage so shadow works reliably
      const aCtx = archive.drawingContext;
      const shadowColor = shadowColorString(settings.personBorderColor);
      aCtx.save();
      aCtx.globalAlpha = 1;
      if (settings.videoMirror) {
        aCtx.translate(s.vp.dx + s.vp.dw, s.vp.dy);
        aCtx.scale(-1, 1);
        aCtx.drawImage(s.fill.canvas, 0, 0, s.vp.dw, s.vp.dh);
        // outline with shadow
        aCtx.shadowBlur = settings.personBorderBlur;
        aCtx.shadowColor = shadowColor;
        aCtx.drawImage(s.outline.canvas, 0, 0, s.vp.dw, s.vp.dh);
      } else {
        aCtx.drawImage(s.fill.canvas, s.vp.dx, s.vp.dy, s.vp.dw, s.vp.dh);
        // outline with shadow
        aCtx.shadowBlur = settings.personBorderBlur;
        aCtx.shadowColor = shadowColor;
        aCtx.drawImage(s.outline.canvas, s.vp.dx, s.vp.dy, s.vp.dw, s.vp.dh);
      }
      aCtx.restore();
      // remove stamp
      stamps.splice(i, 1);
    }
  }
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