// Morris Filigree 2D Taster - Version 11
// SVG Native Vector Font Exporter (Bambu Studio / OrcaSlicer compatible),
// Typographical Baseline Fusion, Seam Collars, & Slicer Fusion

class EditPoint {
  static NullPoint     = 0;
  static StartPoint    = 1;
  static EndPoint      = 2;
  static ControlPoint1 = 3;
  static ControlPoint2 = 4;
}

const SIZEOFPOINT = 8.0;
const STORAGE_KEY = "morris_filigree_v11_session";
const LEGACY_STORAGE_KEY = "morris_filigree_v10_session";

// Viewport sizes
const canvasW = 960;
const canvasH = 620;
const editorW = 440;
const editorH = 560;
const editorOriginX = 30;
const editorOriginY = 30;

// Medallion settings
const medallionCenterX = 710;
const medallionCenterY = 310;
const rInner = 75;  // Inner hub radius
const rOuter = 235; // Outer rim radius

// OpenType Vector Font Engine
let vectorFont = null;
const FONT_URL = "https://cdn.jsdelivr.net/fontsource/fonts/cinzel@latest/latin-400-normal.ttf";

const PALETTE = [
  { name: "Gold",    hex: "#f59e0b", rgb: [245, 158, 11] },
  { name: "Emerald", hex: "#10b981", rgb: [16, 185, 129] },
  { name: "Ruby",    hex: "#f43f5e", rgb: [244, 63, 94] },
  { name: "Cyan",    hex: "#06b6d4", rgb: [6, 182, 212] },
  { name: "Purple",  hex: "#a855f7", rgb: [168, 85, 247] }
];

let curves = [];
let activeCurveIndex = 0;
let editMode = false;
let currentEditPoint = EditPoint.NullPoint;

// Structural Rings Engine
let ringsState = {
  innerHub: { enabled: true, weight: 2.5 },
  outerRim: { enabled: true, weight: 2.5 },
  collars: [
    { normR: 0.40, weight: 2.0, enabled: true },
    { normR: 0.70, weight: 2.0, enabled: true }
  ]
};

// Text Core Configuration
let textState = {
  mode: "linear",
  content: "VICTORIA & ALBERT",
  fontSize: 13,
  tracking: 3.0,
  arcStartDeg: 270,
  underline: {
    enabled: true,
    offset: 0.0,
    amplitude: 10.0,
    weight: 2.0
  }
};

function normRToEditorY(normR) {
  return editorOriginY + (1.0 - normR) * editorH;
}

function editorYToNormR(y) {
  return constrain(1.0 - (y - editorOriginY) / editorH, 0.0, 1.0);
}

class BezierRibbon {
  constructor(name, folds, phaseDeg, isReflected, rStart, rEnd, colorIdx, p0X, c1, c2, p3X) {
    this.name = name;
    this.folds = folds;
    this.phase = phaseDeg;
    this.isReflected = isReflected;
    this.rStart = constrain(rStart, 0.0, 1.0);
    this.rEnd   = constrain(rEnd, 0.0, 1.0);
    this.visible = true;
    this.colorIdx = colorIdx % PALETTE.length;
    this.color = PALETTE[this.colorIdx];

    this.startPt = new PVector(p0X, normRToEditorY(this.rStart));
    this.ctlPt1  = c1.copy();
    this.ctlPt2  = c2.copy();
    this.endPt   = new PVector(p3X, normRToEditorY(this.rEnd));
  }

  updateRadiusTiers() {
    this.startPt.y = normRToEditorY(this.rStart);
    this.endPt.y   = normRToEditorY(this.rEnd);
  }

  toJSON() {
    return {
      name: this.name,
      folds: this.folds,
      phase: this.phase,
      isReflected: this.isReflected,
      rStart: this.rStart,
      rEnd: this.rEnd,
      visible: this.visible,
      colorIdx: this.colorIdx,
      points: {
        start: { x: this.startPt.x, y: this.startPt.y },
        ctl1:  { x: this.ctlPt1.x,  y: this.ctlPt1.y },
        ctl2:  { x: this.ctlPt2.x,  y: this.ctlPt2.y },
        end:   { x: this.endPt.x,   y: this.endPt.y }
      }
    };
  }

  static fromJSON(data) {
    let ribbon = new BezierRibbon(
      data.name,
      data.folds,
      data.phase,
      data.isReflected,
      data.rStart !== undefined ? data.rStart : 0.0,
      data.rEnd   !== undefined ? data.rEnd   : 1.0,
      data.colorIdx,
      data.points.start.x,
      new PVector(data.points.ctl1.x,  data.points.ctl1.y),
      new PVector(data.points.ctl2.x,  data.points.ctl2.y),
      data.points.end.x
    );
    ribbon.visible = data.visible !== undefined ? data.visible : true;
    return ribbon;
  }
}

// -------------------------------------------------------------
// Direct Underline & Ring Docking
// -------------------------------------------------------------

function getTargetRingRadius() {
  if (ringsState.innerHub.enabled) return rInner;
  let activeCollars = ringsState.collars.filter(c => c.enabled);
  if (activeCollars.length > 0) {
    let lowestNorm = Math.min(...activeCollars.map(c => c.normR));
    return rInner + lowestNorm * (rOuter - rInner);
  }
  return ringsState.outerRim.enabled ? rOuter : rInner;
}

function calculateTextLineWidth(str, tracking) {
  let totalW = 0;
  for (let ch of str) {
    totalW += textWidth(ch) + tracking;
  }
  return totalW - tracking;
}

function generateUnderlinePathPoints() {
  if (!textState.content || textState.content.trim() === "" || !textState.underline.enabled) {
    return null;
  }

  let targetR = getTargetRingRadius();
  const fSize = textState.fontSize;

  // ===========================================================
  // 1. LINEAR TEXT MODE
  // ===========================================================
  if (textState.mode === "linear") {
    let lines = textState.content.split("\n");
    let lineH = fSize * 1.35;
    let totalH = lines.length * lineH;
    let bottomLineIdx = lines.length - 1;
    let lastLineStr = lines[bottomLineIdx];

    // Compute center and exact true OpenType baseline Y
    let bottomLineCenterY = -totalH / 2 + lineH / 2 + (bottomLineIdx * lineH);
    let glyphBaselineY = bottomLineCenterY + (fSize * 0.35);

    // Physical weld: position stroke centerline so its top edge directly contacts the glyph baseline
    let baselineY = glyphBaselineY + (textState.underline.weight / 2) - textState.underline.offset;

    let textW = 0;
    if (vectorFont) {
      let glyphs = vectorFont.stringToGlyphs(lastLineStr);
      for (let g of glyphs) {
        let gw = (g.advanceWidth || vectorFont.unitsPerEm) * (fSize / vectorFont.unitsPerEm);
        textW += gw + textState.tracking;
      }
      if (glyphs.length > 0) textW -= textState.tracking;
    } else {
      textFont("Georgia");
      textSize(fSize);
      textW = calculateTextLineWidth(lastLineStr, textState.tracking);
    }

    let xStart = -textW / 2;
    let xEnd   = textW / 2;

    let pts = [];
    pts.push(new PVector(xStart, baselineY));
    pts.push(new PVector(xEnd, baselineY));

    // Sweep from the last character out to strike the container ring
    let targetY = constrain(baselineY - textState.underline.amplitude, -targetR * 0.95, baselineY);
    let disc = targetR * targetR - targetY * targetY;
    let ringHitX = disc > 0 ? Math.sqrt(disc) : targetR;

    let p0 = new PVector(xEnd, baselineY);
    let p1 = new PVector(xEnd + (ringHitX - xEnd) * 0.45, baselineY);
    let p2 = new PVector(ringHitX - (ringHitX - xEnd) * 0.25, targetY);
    let p3 = new PVector(ringHitX, targetY);

    const steps = 30;
    for (let i = 1; i <= steps; i++) {
      let t = i / steps;
      pts.push(calcBezierT(t, p0, p1, p2, p3));
    }

    return pts;
  }

  // ===========================================================
  // 2. ARC RIM MODE
  // ===========================================================
  if (textState.mode === "arc") {
    let chars = textState.content.split("");
    if (chars.length === 0) return null;

    let textR = rInner - fSize * 0.9;
    
    // In Arc mode, glyph baseline sits at radius textR.
    // Underline centerline is placed just outside (smaller radius = inward toward hub)
    let baseArcR = textR - (textState.underline.weight / 2) + textState.underline.offset;

    let startRad = radians(textState.arcStartDeg);
    let charAngularWidth = (fSize + textState.tracking * 2) / textR;

    let startAngle = startRad - (charAngularWidth * 0.5);
    let endAngle   = startRad + (chars.length - 1) * charAngularWidth + (charAngularWidth * 0.5);

    let pts = [];
    const arcSteps = Math.max(16, chars.length * 6);

    for (let i = 0; i <= arcSteps; i++) {
      let t = i / arcSteps;
      let theta = lerp(startAngle, endAngle, t);
      let x = baseArcR * Math.sin(theta);
      let y = -baseArcR * Math.cos(theta);
      pts.push(new PVector(x, y));
    }

    // Sweep flourish from last character to target ring
    let sweepAngleSpan = radians(30);
    let ringHitAngle   = endAngle + sweepAngleSpan;
    const sweepSteps   = 25;

    let pStart = pts[pts.length - 1].copy();
    let pEnd   = new PVector(targetR * Math.sin(ringHitAngle), -targetR * Math.cos(ringHitAngle));

    let ctlR = (baseArcR + targetR) * 0.5;
    let ctlAngle = endAngle + sweepAngleSpan * 0.35;
    let pCtl = new PVector(ctlR * Math.sin(ctlAngle), -ctlR * Math.cos(ctlAngle));

    for (let i = 1; i <= sweepSteps; i++) {
      let t = i / sweepSteps;
      let u = 1 - t;
      let x = u * u * pStart.x + 2 * u * t * pCtl.x + t * t * pEnd.x;
      let y = u * u * pStart.y + 2 * u * t * pCtl.y + t * t * pEnd.y;
      pts.push(new PVector(x, y));
    }

    return pts;
  }

  return null;
}

// -------------------------------------------------------------
// Vector Text Path Generator (Bambu Studio Friendly)
// -------------------------------------------------------------

function generateVectorTextSVG() {
  if (!textState.content || textState.content.trim() === "") return "";
  if (!vectorFont) {
    console.warn("Vector font not loaded yet. Glyphs omitted from vector SVG.");
    return "";
  }

  let svgTextPaths = "";
  const fSize = textState.fontSize;

  if (textState.mode === "linear") {
    let lines = textState.content.split("\n");
    let lineH = fSize * 1.35;
    let totalH = lines.length * lineH;
    let startY = -totalH / 2 + lineH / 2;

    lines.forEach((lineStr, lineIdx) => {
      let curY = startY + lineIdx * lineH;
      let glyphBaselineY = curY + (fSize * 0.35); // Matches generateUnderlinePathPoints baseline
      let glyphs = vectorFont.stringToGlyphs(lineStr);
      let lineWidth = 0;
      let glyphWidths = [];

      for (let g of glyphs) {
        let gw = (g.advanceWidth || vectorFont.unitsPerEm) * (fSize / vectorFont.unitsPerEm);
        glyphWidths.push(gw);
        lineWidth += gw + textState.tracking;
      }
      if (glyphs.length > 0) lineWidth -= textState.tracking;

      let curX = -lineWidth / 2;
      for (let i = 0; i < glyphs.length; i++) {
        let g = glyphs[i];
        let p = g.getPath(curX, glyphBaselineY, fSize);
        svgTextPaths += `    <path class="vector-text-glyph" d="${p.toPathData()}" fill="#1c1917" stroke="none" />\n`;
        curX += glyphWidths[i] + textState.tracking;
      }
    });
  } else {
    let textR = rInner - fSize * 0.9;
    let startRad = radians(textState.arcStartDeg);
    let charAngularWidth = (fSize + textState.tracking * 2) / textR;
    let chars = textState.content.split("");

    chars.forEach((ch, idx) => {
      let currentTheta = startRad + idx * charAngularWidth;
      let deg = (currentTheta * 180 / Math.PI);

      let glyph = vectorFont.charToGlyph(ch);
      let gw = (glyph.advanceWidth || vectorFont.unitsPerEm) * (fSize / vectorFont.unitsPerEm);

      // Glyphs sit with true baseline at (0, 0), rotated and translated to -textR
      let p = glyph.getPath(-gw / 2, 0, fSize);
      let d = p.toPathData();
      if (d && d.length > 0) {
        svgTextPaths += `    <path class="vector-text-glyph" d="${d}" fill="#1c1917" stroke="none" transform="rotate(${deg.toFixed(2)}) translate(0, ${(-textR).toFixed(2)})" />\n`;
      }
    });
  }

  return svgTextPaths;
}

// -------------------------------------------------------------
// SVG Exporter (100% Vector / Zero Slicer-Ignored <text> Tags)
// -------------------------------------------------------------

function exportSVG() {
  const svgW = 600;
  const svgH = 600;
  const cx = svgW / 2;
  const cy = svgH / 2;
  const scaleFactor = 1.0; 

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">\n`;
  svg += `  <style>\n`;
  svg += `    .filigree-path { fill: none; stroke-linecap: round; stroke-linejoin: round; }\n`;
  svg += `    .ring-path { fill: none; stroke: #292524; stroke-linecap: round; }\n`;
  svg += `    .vector-text-glyph { fill-rule: nonzero; }\n`;
  svg += `    .flourish-underline { fill: none; stroke: #f59e0b; stroke-linecap: round; stroke-linejoin: round; }\n`;
  svg += `  </style>\n`;
  svg += `  <rect width="100%" height="100%" fill="#fafaf9" />\n`;
  svg += `  <g transform="translate(${cx}, ${cy}) scale(${scaleFactor})">\n`;

  // 1. Motifs
  curves.forEach((ribbon) => {
    if (!ribbon.visible) return;

    let curveSamples = [];
    const steps = 30;

    for (let i = 0; i <= steps; i++) {
      let t = i / steps;
      let p = calcBezierT(t, ribbon.startPt, ribbon.ctlPt1, ribbon.ctlPt2, ribbon.endPt);
      curveSamples.push(normalizeToTile(p));
    }

    if (ribbon.isReflected) {
      let mCtl1 = reflectPointAcrossChord(ribbon.ctlPt1, ribbon.startPt, ribbon.endPt);
      let mCtl2 = reflectPointAcrossChord(ribbon.ctlPt2, ribbon.startPt, ribbon.endPt);
      for (let i = steps; i >= 0; i--) {
        let t = i / steps;
        let p = calcBezierT(t, ribbon.startPt, mCtl1, mCtl2, ribbon.endPt);
        curveSamples.push(normalizeToTile(p));
      }
    }

    const sectorAngle = TWO_PI / ribbon.folds;
    const phaseRad = radians(ribbon.phase);

    for (let fold = 0; fold < ribbon.folds; fold++) {
      const angle = fold * sectorAngle + phaseRad;
      let pathD = "";

      curveSamples.forEach((normPt, idx) => {
        let theta = normPt.x * sectorAngle;
        let r = rInner + (1.0 - normPt.y) * (rOuter - rInner);
        let lx = r * Math.cos(theta);
        let ly = r * Math.sin(theta);

        let rx = lx * Math.cos(angle) - ly * Math.sin(angle);
        let ry = lx * Math.sin(angle) + ly * Math.cos(angle);

        pathD += (idx === 0 ? "M " : " L ") + `${rx.toFixed(2)},${ry.toFixed(2)}`;
      });

      if (ribbon.isReflected) pathD += " Z";

      svg += `    <path class="filigree-path" d="${pathD}" stroke="${ribbon.color.hex}" stroke-width="1.6" />\n`;
    }
  });

  // 2. Collar Rings
  ringsState.collars.forEach(col => {
    if (!col.enabled) return;
    let r = rInner + col.normR * (rOuter - rInner);
    svg += `    <circle class="ring-path" cx="0" cy="0" r="${r.toFixed(2)}" stroke-width="${col.weight}" />\n`;
  });

  // 3. Hub & Outer Boundary Rings
  if (ringsState.innerHub.enabled) {
    svg += `    <circle class="ring-path" cx="0" cy="0" r="${rInner}" stroke-width="${ringsState.innerHub.weight}" />\n`;
  }
  if (ringsState.outerRim.enabled) {
    svg += `    <circle class="ring-path" cx="0" cy="0" r="${rOuter}" stroke-width="${ringsState.outerRim.weight}" />\n`;
  }

  // 4. Central Text Core - Baked as Pure Vector Paths
  svg += generateVectorTextSVG();

  // 5. Flourished Underline & Ring Docking Path
  if (textState.underline && textState.underline.enabled) {
    let pts = generateUnderlinePathPoints();
    if (pts && pts.length > 0) {
      let pathD = pts.reduce((acc, p, idx) => acc + (idx === 0 ? "M " : " L ") + `${p.x.toFixed(2)},${p.y.toFixed(2)}`, "");
      svg += `    <path class="flourish-underline" d="${pathD}" stroke-width="${textState.underline.weight}" />\n`;
    }
  }

  svg += `  </g>\n`;
  svg += `</svg>\n`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "morris_filigree_medallion_v11.svg";
  a.click();
  URL.revokeObjectURL(url);
}

// -------------------------------------------------------------
// Storage & I/O
// -------------------------------------------------------------

function saveSession() {
  const payload = {
    version: 11,
    activeCurveIndex: activeCurveIndex,
    ringsState: ringsState,
    textState: textState,
    curves: curves.map(c => c.toJSON())
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadSession() {
  let saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!saved) return false;
  try {
    const payload = JSON.parse(saved);
    if (payload.ringsState) ringsState = payload.ringsState;
    if (payload.textState)  {
      textState = Object.assign(textState, payload.textState);
      if (!textState.underline) {
        textState.underline = { enabled: true, offset: 0.0, amplitude: 10.0, weight: 2.0 };
      }
    }
    curves = payload.curves.map(data => BezierRibbon.fromJSON(data));
    activeCurveIndex = payload.activeCurveIndex < curves.length ? payload.activeCurveIndex : 0;
    return true;
  } catch (err) {
    console.warn("Failed to load session:", err);
    return false;
  }
}

function exportJSON() {
  const payload = {
    project: "MorrisFiligree",
    version: 11,
    author: "John Wilson",
    bookReference: "Beginning Graphics Programming with Processing 3 (Open University)",
    exportedAt: new Date().toISOString(),
    ringsState: ringsState,
    textState: textState,
    curves: curves.map(c => c.toJSON())
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "morris_medallion_v11.json";
  a.click();
  URL.revokeObjectURL(url);
}

function importJSONFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const payload = JSON.parse(e.target.result);
      if (payload.curves && Array.isArray(payload.curves)) {
        curves = payload.curves.map(data => BezierRibbon.fromJSON(data));
        if (payload.ringsState) ringsState = payload.ringsState;
        if (payload.textState)  textState  = Object.assign(textState, payload.textState);
        activeCurveIndex = 0;
        syncAllUI();
        saveSession();
      } else {
        alert("Invalid file format.");
      }
    } catch (err) {
      alert("Error reading JSON file.");
    }
  };
  reader.readAsText(file);
}

// -------------------------------------------------------------
// Setup & UI Lifecycle
// -------------------------------------------------------------

function setup() {
  let cnv = createCanvas(canvasW, canvasH);
  cnv.parent("sketch-holder");
  ellipseMode(CENTER);
  rectMode(CENTER);

  // Load OpenType font for real-time vector path extraction
  if (typeof opentype !== "undefined") {
    opentype.load(FONT_URL, function(err, font) {
      if (err) {
        console.warn("Could not load web font for OpenType vector converter:", err);
      } else {
        vectorFont = font;
      }
    });
  }

  const restored = loadSession();
  if (!restored || curves.length === 0) {
    curves.push(new BezierRibbon(
      "Center Spire",
      8, 0, true, 0.0, 1.0, 0,
      editorOriginX + editorW/2,
      new PVector(editorOriginX + editorW/2 + 10, normRToEditorY(0.40)),
      new PVector(editorOriginX + editorW/2 + 4, normRToEditorY(0.85)),
      editorOriginX + editorW/2
    ));

    curves.push(new BezierRibbon(
      "Broad Base Tier",
      8, 0, true, 0.0, 0.40, 1,
      editorOriginX + editorW/2,
      new PVector(editorOriginX + editorW - 60, normRToEditorY(0.15)),
      new PVector(editorOriginX + editorW - 100, normRToEditorY(0.35)),
      editorOriginX + editorW/2
    ));

    curves.push(new BezierRibbon(
      "Mid Barb Tier",
      8, 0, true, 0.40, 0.70, 2,
      editorOriginX + editorW/2,
      new PVector(editorOriginX + editorW - 110, normRToEditorY(0.50)),
      new PVector(editorOriginX + editorW - 140, normRToEditorY(0.65)),
      editorOriginX + editorW/2
    ));

    saveSession();
  }

  hookTabs();
  hookMotifUI();
  hookRingsUI();
  hookTextUI();
  syncAllUI();
}

function syncAllUI() {
  renderLayerDOM();
  renderCollarsDOM();
  syncRingsInputs();
  syncTextInputs();
}

function hookTabs() {
  const tabs = [
    { btn: "tabMotifs", content: "contentMotifs" },
    { btn: "tabRings",  content: "contentRings" },
    { btn: "tabText",   content: "contentText" },
    { btn: "tabHelp",   content: "contentHelp" }
  ];

  tabs.forEach(t => {
    document.getElementById(t.btn).addEventListener("click", () => {
      tabs.forEach(o => {
        document.getElementById(o.btn).classList.remove("active");
        document.getElementById(o.content).classList.remove("active");
      });
      document.getElementById(t.btn).classList.add("active");
      document.getElementById(t.content).classList.add("active");
    });
  });
}

function hookMotifUI() {
  document.getElementById("addCurveBtn").addEventListener("click", () => {
    if (curves.length >= 6) {
      alert("Maximum 6 motif layers recommended.");
      return;
    }
    const idx = curves.length;
    curves.push(new BezierRibbon(
      `Motif ${idx + 1}`,
      8, 0, true, 0.0, 1.0, idx,
      editorOriginX + editorW/2,
      new PVector(editorOriginX + editorW/2 + 60, normRToEditorY(0.3)),
      new PVector(editorOriginX + editorW/2 + 60, normRToEditorY(0.7)),
      editorOriginX + editorW/2
    ));
    activeCurveIndex = curves.length - 1;
    saveSession();
    renderLayerDOM();
  });

  document.getElementById("exportBtn").addEventListener("click", exportJSON);
  document.getElementById("exportSvgBtn").addEventListener("click", exportSVG);

  const fileInput = document.getElementById("fileInput");
  document.getElementById("importBtn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      importJSONFile(e.target.files[0]);
      fileInput.value = "";
    }
  });
}

function renderLayerDOM() {
  const container = document.getElementById("layersList");
  container.innerHTML = "";

  curves.forEach((c, idx) => {
    const card = document.createElement("div");
    card.className = `layer-card ${idx === activeCurveIndex ? "active" : ""}`;
    card.style.borderLeftColor = c.color.hex;

    card.addEventListener("click", (e) => {
      if (e.target.tagName !== "INPUT" && e.target.tagName !== "BUTTON" && e.target.tagName !== "LABEL") {
        activeCurveIndex = idx;
        saveSession();
        renderLayerDOM();
      }
    });

    const topRow = document.createElement("div");
    topRow.className = "layer-row-top";

    const vis = document.createElement("input");
    vis.type = "checkbox";
    vis.checked = c.visible;
    vis.addEventListener("change", (e) => {
      c.visible = e.target.checked;
      saveSession();
    });

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "layer-name-input";
    nameInput.value = c.name;
    nameInput.addEventListener("input", (e) => {
      c.name = e.target.value;
      saveSession();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.innerHTML = "&times;";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (curves.length <= 1) return;
      curves.splice(idx, 1);
      if (activeCurveIndex >= curves.length) activeCurveIndex = curves.length - 1;
      saveSession();
      renderLayerDOM();
    });

    topRow.appendChild(vis);
    topRow.appendChild(nameInput);
    topRow.appendChild(delBtn);

    const toggleRow = document.createElement("div");
    toggleRow.className = "layer-toggle-row";
    const reflLabel = document.createElement("label");
    const reflCheck = document.createElement("input");
    reflCheck.type = "checkbox";
    reflCheck.checked = c.isReflected;
    reflCheck.addEventListener("change", (e) => {
      c.isReflected = e.target.checked;
      saveSession();
    });
    reflLabel.appendChild(reflCheck);
    reflLabel.appendChild(document.createTextNode("Closed Loop (Reflect)"));
    toggleRow.appendChild(reflLabel);

    const rStartRow = makeSliderRow("R Start:", c.rStart, 0.0, 1.0, 0.01, (val) => {
      c.rStart = val;
      c.updateRadiusTiers();
      saveSession();
    }, (v) => v.toFixed(2));

    const rEndRow = makeSliderRow("R End:", c.rEnd, 0.0, 1.0, 0.01, (val) => {
      c.rEnd = val;
      c.updateRadiusTiers();
      saveSession();
    }, (v) => v.toFixed(2));

    const foldsRow = makeSliderRow("Folds:", c.folds, 4, 24, 1, (val) => {
      c.folds = parseInt(val, 10);
      saveSession();
    }, (v) => v);

    const phaseRow = makeSliderRow("Phase:", c.phase, 0, 360, 0.5, (val) => {
      c.phase = val;
      saveSession();
    }, (v) => `${Math.round(v)}°`);

    card.appendChild(topRow);
    card.appendChild(toggleRow);
    card.appendChild(rStartRow);
    card.appendChild(rEndRow);
    card.appendChild(foldsRow);
    card.appendChild(phaseRow);
    container.appendChild(card);
  });
}

function makeSliderRow(label, currentVal, min, max, step, onInput, formatFn) {
  const row = document.createElement("div");
  row.className = "layer-param-row";

  const lbl = document.createElement("span");
  lbl.className = "param-label";
  lbl.textContent = label;

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = min;
  slider.max = max;
  slider.step = step;
  slider.value = currentVal;

  const badge = document.createElement("span");
  badge.className = "param-badge";
  badge.textContent = formatFn(currentVal);

  slider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    badge.textContent = formatFn(val);
    onInput(val);
  });

  row.appendChild(lbl);
  row.appendChild(slider);
  row.appendChild(badge);
  return row;
}

// -------------------------------------------------------------
// Structural Rings Wiring
// -------------------------------------------------------------

function hookRingsUI() {
  document.getElementById("innerHubRingToggle").addEventListener("change", (e) => {
    ringsState.innerHub.enabled = e.target.checked;
    saveSession();
  });
  document.getElementById("innerHubWeightSlider").addEventListener("input", (e) => {
    ringsState.innerHub.weight = parseFloat(e.target.value);
    document.getElementById("innerHubWeightBadge").textContent = `${ringsState.innerHub.weight.toFixed(1)}px`;
    saveSession();
  });

  document.getElementById("outerRimRingToggle").addEventListener("change", (e) => {
    ringsState.outerRim.enabled = e.target.checked;
    saveSession();
  });
  document.getElementById("outerRimWeightSlider").addEventListener("input", (e) => {
    ringsState.outerRim.weight = parseFloat(e.target.value);
    document.getElementById("outerRimWeightBadge").textContent = `${ringsState.outerRim.weight.toFixed(1)}px`;
    saveSession();
  });

  document.getElementById("autoCollarBtn").addEventListener("click", () => {
    let seams = [];
    curves.forEach(c1 => {
      curves.forEach(c2 => {
        if (c1 !== c2 && Math.abs(c1.rEnd - c2.rStart) < 0.001) {
          seams.push(c1.rEnd);
        }
      });
    });

    let newRadius = 0.5;
    if (seams.length > 0) {
      let unused = seams.find(s => !ringsState.collars.some(c => Math.abs(c.normR - s) < 0.02));
      if (unused !== undefined) newRadius = unused;
    }

    ringsState.collars.push({ normR: newRadius, weight: 2.0, enabled: true });
    saveSession();
    renderCollarsDOM();
  });
}

function syncRingsInputs() {
  document.getElementById("innerHubRingToggle").checked = ringsState.innerHub.enabled;
  document.getElementById("innerHubWeightSlider").value = ringsState.innerHub.weight;
  document.getElementById("innerHubWeightBadge").textContent = `${ringsState.innerHub.weight.toFixed(1)}px`;

  document.getElementById("outerRimRingToggle").checked = ringsState.outerRim.enabled;
  document.getElementById("outerRimWeightSlider").value = ringsState.outerRim.weight;
  document.getElementById("outerRimWeightBadge").textContent = `${ringsState.outerRim.weight.toFixed(1)}px`;
}

function renderCollarsDOM() {
  const container = document.getElementById("collarsList");
  container.innerHTML = "";

  ringsState.collars.forEach((col, idx) => {
    const card = document.createElement("div");
    card.style.background = "#242120";
    card.style.padding = "6px 8px";
    card.style.borderRadius = "4px";
    card.style.border = "1px solid #44403c";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.gap = "4px";

    const topRow = document.createElement("div");
    topRow.style.display = "flex";
    topRow.style.alignItems = "center";
    topRow.style.gap = "6px";

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = col.enabled;
    toggle.addEventListener("change", (e) => {
      col.enabled = e.target.checked;
      saveSession();
    });

    const title = document.createElement("span");
    title.style.fontWeight = "600";
    title.style.color = "#d6d3d1";
    title.textContent = `Collar ${idx + 1}`;

    const del = document.createElement("button");
    del.className = "delete-btn";
    del.innerHTML = "&times;";
    del.addEventListener("click", () => {
      ringsState.collars.splice(idx, 1);
      saveSession();
      renderCollarsDOM();
    });

    topRow.appendChild(toggle);
    topRow.appendChild(title);
    topRow.appendChild(del);

    const rRow = makeSliderRow("Radius:", col.normR, 0.05, 0.95, 0.01, (v) => {
      col.normR = v;
      saveSession();
    }, (v) => v.toFixed(2));

    const wRow = makeSliderRow("Weight:", col.weight, 1, 6, 0.5, (v) => {
      col.weight = v;
      saveSession();
    }, (v) => `${v.toFixed(1)}px`);

    card.appendChild(topRow);
    card.appendChild(rRow);
    card.appendChild(wRow);
    container.appendChild(card);
  });
}

// -------------------------------------------------------------
// Text Core & Underline Wiring
// -------------------------------------------------------------

function hookTextUI() {
  document.querySelectorAll("input[name=textMode]").forEach(r => {
    r.addEventListener("change", (e) => {
      textState.mode = e.target.value;
      document.getElementById("arcAngleRow").style.display = textState.mode === "arc" ? "flex" : "none";
      saveSession();
    });
  });

  document.getElementById("coreTextInput").addEventListener("input", (e) => {
    textState.content = e.target.value;
    saveSession();
  });

  document.getElementById("coreTextSizeSlider").addEventListener("input", (e) => {
    textState.fontSize = parseInt(e.target.value, 10);
    document.getElementById("coreTextSizeBadge").textContent = `${textState.fontSize}px`;
    saveSession();
  });

  document.getElementById("coreTextTrackingSlider").addEventListener("input", (e) => {
    textState.tracking = parseFloat(e.target.value);
    document.getElementById("coreTextTrackingBadge").textContent = textState.tracking.toFixed(1);
    saveSession();
  });

  document.getElementById("arcStartAngleSlider").addEventListener("input", (e) => {
    textState.arcStartDeg = parseInt(e.target.value, 10);
    document.getElementById("arcStartAngleBadge").textContent = `${textState.arcStartDeg}°`;
    saveSession();
  });

  // Underline Listeners
  document.getElementById("underlineEnabledToggle").addEventListener("change", (e) => {
    textState.underline.enabled = e.target.checked;
    saveSession();
  });

  document.getElementById("underlineOffsetSlider").addEventListener("input", (e) => {
    textState.underline.offset = parseFloat(e.target.value);
    document.getElementById("underlineOffsetBadge").textContent = `${textState.underline.offset.toFixed(1)}px`;
    saveSession();
  });

  document.getElementById("underlineAmpSlider").addEventListener("input", (e) => {
    textState.underline.amplitude = parseFloat(e.target.value);
    document.getElementById("underlineAmpBadge").textContent = `${textState.underline.amplitude.toFixed(0)}px`;
    saveSession();
  });

  document.getElementById("underlineWeightSlider").addEventListener("input", (e) => {
    textState.underline.weight = parseFloat(e.target.value);
    document.getElementById("underlineWeightBadge").textContent = `${textState.underline.weight.toFixed(2)}px`;
    saveSession();
  });
}

function syncTextInputs() {
  document.querySelectorAll("input[name=textMode]").forEach(r => {
    r.checked = (r.value === textState.mode);
  });
  document.getElementById("arcAngleRow").style.display = textState.mode === "arc" ? "flex" : "none";
  document.getElementById("coreTextInput").value = textState.content;
  document.getElementById("coreTextSizeSlider").value = textState.fontSize;
  document.getElementById("coreTextSizeBadge").textContent = `${textState.fontSize}px`;
  document.getElementById("coreTextTrackingSlider").value = textState.tracking;
  document.getElementById("coreTextTrackingBadge").textContent = textState.tracking.toFixed(1);
  document.getElementById("arcStartAngleSlider").value = textState.arcStartDeg;
  document.getElementById("arcStartAngleBadge").textContent = `${textState.arcStartDeg}°`;

  document.getElementById("underlineEnabledToggle").checked = textState.underline.enabled;
  document.getElementById("underlineOffsetSlider").value = textState.underline.offset;
  document.getElementById("underlineOffsetBadge").textContent = `${textState.underline.offset.toFixed(1)}px`;
  document.getElementById("underlineAmpSlider").value = textState.underline.amplitude;
  document.getElementById("underlineAmpBadge").textContent = `${textState.underline.amplitude.toFixed(0)}px`;
  document.getElementById("underlineWeightSlider").value = textState.underline.weight;
  document.getElementById("underlineWeightBadge").textContent = `${textState.underline.weight.toFixed(2)}px`;
}

// -------------------------------------------------------------
// Main Render Loop
// -------------------------------------------------------------

function draw() {
  background(28, 25, 23);

  const activeRibbon = curves[activeCurveIndex];

  // 1. LEFT PANE: Sector Editor
  drawEditorFrame(activeRibbon);

  curves.forEach((ribbon, idx) => {
    if (idx !== activeCurveIndex && ribbon.visible) {
      drawRibbonShape(ribbon, 0.25, 1.0);
    }
  });

  if (activeRibbon && activeRibbon.visible) {
    stroke(100);
    strokeWeight(1);
    line(activeRibbon.startPt.x, activeRibbon.startPt.y, activeRibbon.ctlPt1.x, activeRibbon.ctlPt1.y);
    line(activeRibbon.ctlPt1.x, activeRibbon.ctlPt1.y, activeRibbon.ctlPt2.x, activeRibbon.ctlPt2.y);
    line(activeRibbon.ctlPt2.x, activeRibbon.ctlPt2.y, activeRibbon.endPt.x, activeRibbon.endPt.y);

    if (activeRibbon.isReflected) {
      let mCtl1 = reflectPointAcrossChord(activeRibbon.ctlPt1, activeRibbon.startPt, activeRibbon.endPt);
      let mCtl2 = reflectPointAcrossChord(activeRibbon.ctlPt2, activeRibbon.startPt, activeRibbon.endPt);
      stroke(60);
      line(activeRibbon.startPt.x, activeRibbon.startPt.y, mCtl1.x, mCtl1.y);
      line(mCtl1.x, mCtl1.y, mCtl2.x, mCtl2.y);
      line(mCtl2.x, mCtl2.y, activeRibbon.endPt.x, activeRibbon.endPt.y);
    }

    drawRibbonShape(activeRibbon, 1.0, 2.0);

    drawEditPoint(EditPoint.StartPoint, activeRibbon.startPt, true);
    drawEditPoint(EditPoint.EndPoint, activeRibbon.endPt, true);
    drawEditPoint(EditPoint.ControlPoint1, activeRibbon.ctlPt1, false);
    drawEditPoint(EditPoint.ControlPoint2, activeRibbon.ctlPt2, false);
  }

  // 2. RIGHT PANE: Polar Medallion
  drawMedallionFrame();

  push();
  translate(medallionCenterX, medallionCenterY);

  // A. Motifs Rendering
  curves.forEach((ribbon) => {
    if (!ribbon.visible) return;

    let curveSamples = [];
    const steps = 30;

    for (let i = 0; i <= steps; i++) {
      let t = i / steps;
      let p = calcBezierT(t, ribbon.startPt, ribbon.ctlPt1, ribbon.ctlPt2, ribbon.endPt);
      curveSamples.push(normalizeToTile(p));
    }

    if (ribbon.isReflected) {
      let mCtl1 = reflectPointAcrossChord(ribbon.ctlPt1, ribbon.startPt, ribbon.endPt);
      let mCtl2 = reflectPointAcrossChord(ribbon.ctlPt2, ribbon.startPt, ribbon.endPt);
      for (let i = steps; i >= 0; i--) {
        let t = i / steps;
        let p = calcBezierT(t, ribbon.startPt, mCtl1, mCtl2, ribbon.endPt);
        curveSamples.push(normalizeToTile(p));
      }
    }

    const sectorAngle = TWO_PI / ribbon.folds;
    const phaseRad = radians(ribbon.phase);

    for (let fold = 0; fold < ribbon.folds; fold++) {
      push();
      rotate(fold * sectorAngle + phaseRad);

      stroke(ribbon.color.rgb[0], ribbon.color.rgb[1], ribbon.color.rgb[2]);
      strokeWeight(1.6);
      noFill();

      beginShape();
      for (let normPt of curveSamples) {
        let theta = normPt.x * sectorAngle;
        let r = rInner + (1.0 - normPt.y) * (rOuter - rInner);
        let x = r * cos(theta);
        let y = r * sin(theta);
        vertex(x, y);
      }
      endShape(ribbon.isReflected ? CLOSE : undefined);
      pop();
    }
  });

  // B. Structural Seam Collar Rings
  ringsState.collars.forEach(col => {
    if (!col.enabled) return;
    let r = rInner + col.normR * (rOuter - rInner);
    noFill();
    stroke(214, 211, 209);
    strokeWeight(col.weight);
    ellipse(0, 0, r * 2, r * 2);
  });

  // C. Inner Hub & Outer Rim Hoops
  noFill();
  if (ringsState.innerHub.enabled) {
    stroke(245, 158, 11);
    strokeWeight(ringsState.innerHub.weight);
    ellipse(0, 0, rInner * 2, rInner * 2);
  }

  if (ringsState.outerRim.enabled) {
    stroke(245, 158, 11);
    strokeWeight(ringsState.outerRim.weight);
    ellipse(0, 0, rOuter * 2, rOuter * 2);
  }

  // D. Center Text Core Inscription & Underline Flourish
  drawTextCore();

  pop();
}

// -------------------------------------------------------------
// Render Helpers
// -------------------------------------------------------------

function drawTextCore() {
  if (!textState.content || textState.content.trim() === "") return;

  fill(252, 211, 77);
  noStroke();
  textFont("Georgia");
  textSize(textState.fontSize);
  textAlign(CENTER, CENTER);

  if (textState.mode === "linear") {
    let lines = textState.content.split("\n");
    let lineH = textState.fontSize * 1.35;
    let totalH = lines.length * lineH;
    let startY = -totalH / 2 + lineH / 2;

    lines.forEach((ln, i) => {
      drawKernedLine(ln, 0, startY + i * lineH, textState.tracking);
    });
  } else {
    let chars = textState.content.split("");
    let textR = rInner - textState.fontSize * 0.9;
    let startRad = radians(textState.arcStartDeg);
    let charAngularWidth = (textState.fontSize + textState.tracking * 2) / textR;

    chars.forEach((ch, i) => {
      let currentTheta = startRad + i * charAngularWidth;
      push();
      rotate(currentTheta);
      translate(0, -textR);
      text(ch, 0, 0);
      pop();
    });
  }

  // Draw Flourish Underline & Ring Docking Path
  if (textState.underline && textState.underline.enabled) {
    let pts = generateUnderlinePathPoints();
    if (pts && pts.length > 0) {
      noFill();
      stroke(245, 158, 11);
      strokeWeight(textState.underline.weight);
      beginShape();
      for (let pt of pts) {
        vertex(pt.x, pt.y);
      }
      endShape();
    }
  }
}

function drawKernedLine(str, x, y, tracking) {
  let totalW = calculateTextLineWidth(str, tracking);
  let curX = x - totalW / 2;
  for (let ch of str) {
    let w = textWidth(ch);
    text(ch, curX + w / 2, y);
    curX += w + tracking;
  }
}

function drawRibbonShape(ribbon, alphaMult, strokeW) {
  noFill();
  stroke(ribbon.color.rgb[0], ribbon.color.rgb[1], ribbon.color.rgb[2], 255 * alphaMult);
  strokeWeight(strokeW);

  const steps = 30;
  beginShape();
  for (let i = 0; i <= steps; i++) {
    let t = i / steps;
    let p = calcBezierT(t, ribbon.startPt, ribbon.ctlPt1, ribbon.ctlPt2, ribbon.endPt);
    vertex(p.x, p.y);
  }

  if (ribbon.isReflected) {
    let mCtl1 = reflectPointAcrossChord(ribbon.ctlPt1, ribbon.startPt, ribbon.endPt);
    let mCtl2 = reflectPointAcrossChord(ribbon.ctlPt2, ribbon.startPt, ribbon.endPt);
    for (let i = steps; i >= 0; i--) {
      let t = i / steps;
      let p = calcBezierT(t, ribbon.startPt, mCtl1, mCtl2, ribbon.endPt);
      vertex(p.x, p.y);
    }
    endShape(CLOSE);
  } else {
    endShape();
  }
}

function normalizeToTile(p) {
  let u = constrain((p.x - editorOriginX) / editorW, 0, 1);
  let v = constrain((p.y - editorOriginY) / editorH, 0, 1);
  return new PVector(u, v);
}

function reflectPointAcrossChord(p, a, b) {
  let ab = PVector.sub(b, a);
  let ap = PVector.sub(p, a);
  let abLenSq = ab.magSq();
  if (abLenSq === 0) return p.copy();

  let t = ap.dot(ab) / abLenSq;
  let proj = PVector.add(a, PVector.mult(ab, t));
  return new PVector(2 * proj.x - p.x, 2 * proj.y - p.y);
}

function calcBezierT(t, p0, p1, p2, p3) {
  const u = 1 - t;
  const usq = u * u;
  const ucb = usq * u;
  const tsq = t * t;
  const tcb = tsq * t;

  let bt = PVector.mult(p0, ucb);
  bt.add(PVector.mult(p1, 3 * usq * t));
  bt.add(PVector.mult(p2, 3 * u * tsq));
  bt.add(PVector.mult(p3, tcb));
  return bt;
}

function drawEditorFrame(activeRibbon) {
  fill(38, 35, 32);
  stroke(68, 64, 60);
  strokeWeight(1);
  rect(editorOriginX + editorW/2, editorOriginY + editorH/2, editorW, editorH, 4);

  // Active Collar Seam Lines
  ringsState.collars.forEach(col => {
    if (!col.enabled) return;
    let y = normRToEditorY(col.normR);
    stroke(120, 113, 108, 140);
    strokeWeight(1);
    drawingContext.setLineDash([3, 5]);
    line(editorOriginX, y, editorOriginX + editorW, y);
    drawingContext.setLineDash([]);
  });

  // Active motif tier guide lines
  if (activeRibbon) {
    let yStart = normRToEditorY(activeRibbon.rStart);
    let yEnd   = normRToEditorY(activeRibbon.rEnd);

    stroke(activeRibbon.color.rgb[0], activeRibbon.color.rgb[1], activeRibbon.color.rgb[2], 160);
    strokeWeight(1.2);
    drawingContext.setLineDash([4, 4]);
    line(editorOriginX, yStart, editorOriginX + editorW, yStart);
    line(editorOriginX, yEnd,   editorOriginX + editorW, yEnd);
    drawingContext.setLineDash([]);
  }

  fill(168, 162, 158);
  noStroke();
  textSize(11);
  text("Outer Rim (r = 1.0)", editorOriginX + 12, editorOriginY + 16);
  text("Inner Hub (r = 0.0)", editorOriginX + 12, editorOriginY + editorH - 8);

  let folds = activeRibbon ? activeRibbon.folds : 8;
  let degSpan = (360.0 / folds).toFixed(1);
  text(`Sector ${degSpan}°`, editorOriginX + editorW - 85, editorOriginY + editorH / 2);
}

function drawMedallionFrame() {
  noFill();
  stroke(60, 56, 52);
  strokeWeight(1);
  ellipse(medallionCenterX, medallionCenterY, rOuter * 2, rOuter * 2);
  ellipse(medallionCenterX, medallionCenterY, rInner * 2, rInner * 2);
}

function drawEditPoint(ptType, p, isSquare) {
  stroke(255);
  strokeWeight(1.5);
  if (ptType === currentEditPoint) {
    fill(239, 68, 68);
  } else {
    fill(40);
  }

  if (isSquare) {
    rect(p.x, p.y, SIZEOFPOINT, SIZEOFPOINT);
  } else {
    ellipse(p.x, p.y, SIZEOFPOINT, SIZEOFPOINT);
  }
}

// -------------------------------------------------------------
// Interactive Mouse Handling
// -------------------------------------------------------------

function isMouseNear(p) {
  let dSq = (mouseX - p.x) * (mouseX - p.x) + (mouseY - p.y) * (mouseY - p.y);
  return dSq < 14 * 14;
}

function searchEditPoint() {
  const activeRibbon = curves[activeCurveIndex];
  if (!activeRibbon || !activeRibbon.visible) return EditPoint.NullPoint;

  if (isMouseNear(activeRibbon.startPt)) return EditPoint.StartPoint;
  if (isMouseNear(activeRibbon.endPt))   return EditPoint.EndPoint;
  if (isMouseNear(activeRibbon.ctlPt1))  return EditPoint.ControlPoint1;
  if (isMouseNear(activeRibbon.ctlPt2))  return EditPoint.ControlPoint2;
  return EditPoint.NullPoint;
}

function mousePressed() {
  currentEditPoint = searchEditPoint();
  if (currentEditPoint !== EditPoint.NullPoint) {
    editMode = true;
  }
}

function mouseReleased() {
  if (editMode) {
    saveSession();
  }
  editMode = false;
  currentEditPoint = EditPoint.NullPoint;
}

function mouseDragged() {
  if (!editMode) return;
  const activeRibbon = curves[activeCurveIndex];
  if (!activeRibbon) return;

  let clampedX = constrain(mouseX, editorOriginX, editorOriginX + editorW);
  let clampedY = constrain(mouseY, editorOriginY, editorOriginY + editorH);

  switch (currentEditPoint) {
    case EditPoint.StartPoint:
      activeRibbon.startPt.x = clampedX;
      activeRibbon.startPt.y = normRToEditorY(activeRibbon.rStart);
      break;
    case EditPoint.EndPoint:
      activeRibbon.endPt.x = clampedX;
      activeRibbon.endPt.y = normRToEditorY(activeRibbon.rEnd);
      break;
    case EditPoint.ControlPoint1:
      activeRibbon.ctlPt1.set(clampedX, clampedY);
      break;
    case EditPoint.ControlPoint2:
      activeRibbon.ctlPt2.set(clampedX, clampedY);
      break;
  }
}

// -------------------------------------------------------------
// Vector math helper class
// -------------------------------------------------------------
class PVector {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  set(x, y, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  copy() {
    return new PVector(this.x, this.y, this.z);
  }
  static sub(v1, v2) {
    return new PVector(v1.x - v2.x, v1.y - v2.y, v1.z - v2.z);
  }
  static add(v1, v2) {
    return new PVector(v1.x + v2.x, v1.y + v2.y, v1.z + v2.z);
  }
  static mult(v, k) {
    return new PVector(v.x * k, v.y * k, v.z * k);
  }
  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  magSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
  }
}


