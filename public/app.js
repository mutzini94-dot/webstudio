/* ============================================================
   WebStudio — Module 1: Core Studio
   Vanilla JS. Scenes, live sources, canvas compositing,
   drag/resize editing, properties, audio mixer, recording.
   ============================================================ */
(() => {
  'use strict';

  // ---------- constants ----------
  const CW = 1280, CH = 720;
  const STORE_KEY = 'webstudio.project.v1';

  const TYPE_META = {
    display: { icon: '🖥️', label: '화면 캡처', media: true,  audio: true },
    camera:  { icon: '📷', label: '웹캠',       media: true,  audio: true },
    audio:   { icon: '🎙️', label: '오디오 입력', media: true,  audio: true, noVisual: true },
    image:   { icon: '🖼️', label: '이미지',     media: true,  audio: false },
    video:   { icon: '🎬', label: '비디오',     media: true,  audio: true },
    text:    { icon: '🔤', label: '텍스트',     media: false, audio: false },
    color:   { icon: '🎨', label: '색상/도형',  media: false, audio: false },
    browser: { icon: '🌐', label: '브라우저',   media: false, audio: false, overlay: true },
  };

  // ---------- element refs ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('preview');
  const ctx2d = canvas.getContext('2d');
  const canvasFrame = $('canvasFrame');
  const overlayLayer = $('overlayLayer');
  const selectionEl = $('selection');
  const fileInput = $('fileInput');

  // ---------- runtime (non-serialized) per source id ----------
  // { videoEl, imgEl, stream, gain, analyser, meterData, monitor }
  const rt = new Map();

  // ---------- state ----------
  let project = { scenes: [], activeSceneId: null };
  let selectedId = null;
  let audioCtx = null, mixDest = null;

  const uid = () => Math.random().toString(36).slice(2, 9);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const scene = () => project.scenes.find((s) => s.id === project.activeSceneId);
  const sources = () => (scene() ? scene().sources : []);
  const findSource = (id) => sources().find((s) => s.id === id);

  // ============================================================
  //  PERSISTENCE
  // ============================================================
  function save() {
    const slim = {
      activeSceneId: project.activeSceneId,
      scenes: project.scenes.map((s) => ({
        id: s.id, name: s.name,
        sources: s.sources.map((src) => {
          const o = { ...src };
          delete o._runtime;
          // media sources can't persist their live stream/blob
          if (TYPE_META[src.type].media) o.needsReconnect = true;
          return o;
        }),
      })),
    };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(slim)); } catch (e) {}
  }

  function load() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) {}
    if (data && data.scenes && data.scenes.length) {
      project = data;
    } else {
      // seed a first scene with a welcome text + color background
      const s = { id: uid(), name: '장면 1', sources: [] };
      project = { scenes: [s], activeSceneId: s.id };
    }
  }

  // ============================================================
  //  SOURCE FACTORIES
  // ============================================================
  function baseSource(type, name, geo) {
    return Object.assign(
      { id: uid(), type, name: name || TYPE_META[type].label,
        x: 0, y: 0, w: 400, h: 300, opacity: 1, visible: true, locked: false },
      geo || {}
    );
  }
  function mkText(text, g) {
    return Object.assign(baseSource('text', '텍스트', { x: 60, y: 60, w: 600, h: 120 }), {
      text: text || '텍스트를 입력하세요', color: '#ffffff', size: 64, weight: 700,
      align: 'left', font: 'Inter', bg: 'none', stroke: false,
    }, g || {});
  }
  function mkColor(g) {
    return Object.assign(baseSource('color', '색상/도형', { x: 440, y: 210, w: 400, h: 300 }), {
      color: '#5b8cff', shape: 'rect', radius: 16,
    }, g || {});
  }
  function mkBrowser(url) {
    return Object.assign(baseSource('browser', '브라우저 소스', { x: 340, y: 140, w: 600, h: 440 }), {
      url: url || 'https://obsproject.com/ko',
    });
  }

  // ============================================================
  //  ADD SOURCE dispatch
  // ============================================================
  async function addSource(type) {
    closeSourceMenu();
    try {
      switch (type) {
        case 'display': return await addCapture('display');
        case 'camera':  return await addCapture('camera');
        case 'audio':   return await addCapture('audio');
        case 'image':   return pickFile('image/*', (file) => addImage(file));
        case 'video':   return pickFile('video/*', (file) => addVideo(file));
        case 'text':    return commitNew(mkText());
        case 'color':   return commitNew(mkColor());
        case 'browser': {
          const url = prompt('웹페이지 URL을 입력하세요', 'https://obsproject.com/ko');
          if (url) return commitNew(mkBrowser(url));
          return;
        }
      }
    } catch (e) {
      toast(captureError(type, e), true);
    }
  }

  function commitNew(src) {
    sources().unshift(src); // new source on top
    select(src.id);
    renderAll();
    save();
    return src;
  }

  function captureError(type, e) {
    if (e && e.name === 'NotAllowedError') return '권한이 거부되었습니다.';
    if (e && e.name === 'NotFoundError') return '사용 가능한 장치를 찾을 수 없습니다.';
    return (TYPE_META[type]?.label || '소스') + ' 추가 실패: ' + (e?.message || e);
  }

  // ----- media capture -----
  async function addCapture(kind, existing) {
    let stream, src;
    if (kind === 'display') {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      src = existing || baseSource('display', '화면 캡처', { x: 0, y: 0, w: CW, h: CH });
    } else if (kind === 'camera') {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      src = existing || baseSource('camera', '웹캠', { x: 824, y: 450, w: 426, h: 240 });
    } else if (kind === 'audio') {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      src = existing || baseSource('audio', '오디오 입력', { x: 0, y: 0, w: 0, h: 0 });
    }
    attachStream(src, stream, kind);
    if (existing) { existing.needsReconnect = false; renderAll(); save(); return existing; }
    return commitNew(src);
  }

  function attachStream(src, stream, kind) {
    const r = rt.get(src.id) || {};
    r.stream = stream;
    if (kind !== 'audio') {
      const v = document.createElement('video');
      v.autoplay = true; v.muted = true; v.playsInline = true;
      v.srcObject = stream;
      v.play().catch(() => {});
      r.videoEl = v;
      // if capture ends (user clicks browser "stop sharing")
      const vt = stream.getVideoTracks()[0];
      if (vt) vt.onended = () => { toast(src.name + ' 캡처가 종료되었습니다.'); src.needsReconnect = true; renderAll(); };
    }
    rt.set(src.id, r);
    // audio routing (mic / display audio / camera audio)
    if (stream.getAudioTracks().length) setupSourceAudio(src, new MediaStream(stream.getAudioTracks()));
    renderMixer();
  }

  function addImage(file) {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(640 / img.width, 640 / img.height, 1);
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const src = baseSource('image', file.name.replace(/\.[^.]+$/, ''),
        { x: (CW - w) / 2 | 0, y: (CH - h) / 2 | 0, w, h });
      src.fit = 'fill';
      rt.set(src.id, { imgEl: img, natW: img.width, natH: img.height });
      commitNew(src);
    };
    img.src = URL.createObjectURL(file);
  }

  function addVideo(file) {
    const v = document.createElement('video');
    v.src = URL.createObjectURL(file);
    v.loop = true; v.muted = false; v.playsInline = true;
    v.onloadedmetadata = () => {
      const scale = Math.min(720 / v.videoWidth, 720 / v.videoHeight, 1);
      const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
      const src = baseSource('video', file.name.replace(/\.[^.]+$/, ''),
        { x: (CW - w) / 2 | 0, y: (CH - h) / 2 | 0, w, h });
      src.loop = true; src.playing = true;
      rt.set(src.id, { videoEl: v });
      v.play().catch(() => {});
      setupElementAudio(src, v);
      commitNew(src);
    };
  }

  // ----- reconnect a persisted media source -----
  async function reconnect(src) {
    try {
      if (src.type === 'display' || src.type === 'camera' || src.type === 'audio') {
        await addCapture(src.type, src);
      } else if (src.type === 'image') {
        pickFile('image/*', (file) => {
          const img = new Image();
          img.onload = () => { rt.set(src.id, { imgEl: img, natW: img.width, natH: img.height }); src.needsReconnect = false; renderAll(); save(); };
          img.src = URL.createObjectURL(file);
        });
      } else if (src.type === 'video') {
        pickFile('video/*', (file) => {
          const v = document.createElement('video');
          v.src = URL.createObjectURL(file); v.loop = !!src.loop; v.playsInline = true;
          v.onloadedmetadata = () => { rt.set(src.id, { videoEl: v }); if (src.playing !== false) v.play().catch(()=>{}); setupElementAudio(src, v); src.needsReconnect = false; renderAll(); save(); };
        });
      }
    } catch (e) { toast(captureError(src.type, e), true); }
  }

  // ============================================================
  //  AUDIO ENGINE
  // ============================================================
  function ensureAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    mixDest = audioCtx.createMediaStreamDestination();
  }
  function setupSourceAudio(src, audioStream) {
    ensureAudio();
    const node = audioCtx.createMediaStreamSource(audioStream);
    wireAudio(src, node, false);
  }
  function setupElementAudio(src, mediaEl) {
    ensureAudio();
    const r = rt.get(src.id) || {};
    if (r._mediaNode) return;
    const node = audioCtx.createMediaElementSource(mediaEl);
    r._mediaNode = node; rt.set(src.id, r);
    wireAudio(src, node, true); // monitor video/media playback through speakers
  }
  function wireAudio(src, node, defaultMonitor) {
    const r = rt.get(src.id) || {};
    const gain = audioCtx.createGain();
    gain.gain.value = src.muted ? 0 : (src.volume ?? 1);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    node.connect(gain);
    gain.connect(analyser);
    gain.connect(mixDest);
    r.gain = gain; r.analyser = analyser; r.meterData = new Uint8Array(analyser.fftSize);
    r.hasAudio = true; r.monitorConnected = false; r.peak = 0;
    if (src.volume == null) src.volume = 1;
    if (src.monitor == null) src.monitor = !!defaultMonitor;
    rt.set(src.id, r);
    setMonitor(src, src.monitor);
  }
  function setMonitor(src, on) {
    const r = rt.get(src.id);
    if (!r || !r.gain) return;
    src.monitor = on;
    try {
      if (on && !r.monitorConnected) { r.gain.connect(audioCtx.destination); r.monitorConnected = true; }
      else if (!on && r.monitorConnected) { r.gain.disconnect(audioCtx.destination); r.monitorConnected = false; }
    } catch (e) {}
  }
  function applyGain(src) {
    const r = rt.get(src.id);
    if (r && r.gain) r.gain.gain.value = src.muted ? 0 : (src.volume ?? 1);
  }
  const volToDb = (v) => (v <= 0.001 ? '-∞' : (20 * Math.log10(v)).toFixed(1));

  // ============================================================
  //  RENDER LOOP (compositing + meters + fps)
  // ============================================================
  let frames = 0, fpsT = performance.now(), lastFps = 0;
  let rafId = null, intId = null;
  // Canvas-capture tracks (recording/streaming) that need a manual frame push
  // each draw — guarantees frames independent of the compositor.
  const captureTracks = new Set();

  function frame() {
    drawScene();
    if (captureTracks.size) captureTracks.forEach((t) => { try { t.requestFrame(); } catch (e) {} });
    updateMeters();
    positionOverlaysAndSelection();
    frames++;
    const now = performance.now();
    if (now - fpsT >= 500) { lastFps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; $('fpsInfo').textContent = lastFps + ' fps'; }
  }

  // Drive with rAF when visible (smooth), but fall back to a timer when the
  // tab is backgrounded so compositing/recording never freezes.
  function useRAF() {
    if (intId) { clearInterval(intId); intId = null; }
    if (rafId) return;
    const loop = () => { frame(); rafId = requestAnimationFrame(loop); };
    rafId = requestAnimationFrame(loop);
  }
  function useTimer() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (intId) return;
    intId = setInterval(frame, 1000 / 30);
  }
  function startLoop() { document.hidden ? useTimer() : useRAF(); }
  document.addEventListener('visibilitychange', startLoop);

  function drawScene() {
    ctx2d.clearRect(0, 0, CW, CH);
    // checkerboard-ish dark base
    ctx2d.fillStyle = '#000';
    ctx2d.fillRect(0, 0, CW, CH);
    const list = sources();
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (!s.visible || TYPE_META[s.type].noVisual || TYPE_META[s.type].overlay) continue;
      ctx2d.save();
      ctx2d.globalAlpha = s.opacity;
      if (s.needsReconnect) drawPlaceholder(s);
      else drawSource(s);
      ctx2d.restore();
    }
  }

  function drawSource(s) {
    const r = rt.get(s.id);
    switch (s.type) {
      case 'display':
      case 'camera':
      case 'video': {
        const v = r && r.videoEl;
        if (v && v.readyState >= 2) drawCover(v, s);
        else drawPlaceholder(s);
        break;
      }
      case 'image': {
        const img = r && r.imgEl;
        if (img && img.complete) ctx2d.drawImage(img, s.x, s.y, s.w, s.h);
        else drawPlaceholder(s);
        break;
      }
      case 'color': {
        ctx2d.fillStyle = s.color;
        if (s.shape === 'ellipse') { ellipse(s); ctx2d.fill(); }
        else if (s.shape === 'rounded') { roundRect(s.x, s.y, s.w, s.h, s.radius || 16); ctx2d.fill(); }
        else ctx2d.fillRect(s.x, s.y, s.w, s.h);
        break;
      }
      case 'text': drawText(s); break;
    }
  }

  function drawCover(media, s) {
    // object-fit: cover into s box
    const mw = media.videoWidth || media.naturalWidth, mh = media.videoHeight || media.naturalHeight;
    if (!mw || !mh) return;
    const scale = Math.max(s.w / mw, s.h / mh);
    const dw = mw * scale, dh = mh * scale;
    const dx = s.x + (s.w - dw) / 2, dy = s.y + (s.h - dh) / 2;
    ctx2d.save();
    roundRect(s.x, s.y, s.w, s.h, 0); ctx2d.clip();
    ctx2d.drawImage(media, dx, dy, dw, dh);
    ctx2d.restore();
  }

  function drawText(s) {
    if (s.bg && s.bg !== 'none') { ctx2d.fillStyle = s.bg; roundRect(s.x, s.y, s.w, s.h, 10); ctx2d.fill(); }
    ctx2d.fillStyle = s.color;
    ctx2d.font = `${s.weight || 700} ${s.size}px ${s.font || 'Inter'}, sans-serif`;
    ctx2d.textBaseline = 'top';
    ctx2d.textAlign = s.align || 'left';
    const pad = 8;
    const tx = s.align === 'center' ? s.x + s.w / 2 : s.align === 'right' ? s.x + s.w - pad : s.x + pad;
    const lines = wrapText(s.text || '', s.w - pad * 2);
    let ty = s.y + pad;
    for (const line of lines) {
      if (s.stroke) { ctx2d.lineWidth = Math.max(2, s.size / 16); ctx2d.strokeStyle = 'rgba(0,0,0,.75)'; ctx2d.strokeText(line, tx, ty); }
      ctx2d.fillText(line, tx, ty);
      ty += s.size * 1.18;
    }
  }
  function wrapText(text, maxW) {
    const out = [];
    for (const para of String(text).split('\n')) {
      const words = para.split(' '); let line = '';
      for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (ctx2d.measureText(test).width > maxW && line) { out.push(line); line = w; }
        else line = test;
      }
      out.push(line);
    }
    return out;
  }

  function drawPlaceholder(s) {
    ctx2d.save();
    ctx2d.setLineDash([8, 6]);
    ctx2d.strokeStyle = 'rgba(140,150,180,.5)';
    ctx2d.lineWidth = 2;
    ctx2d.strokeRect(s.x + 1, s.y + 1, s.w - 2, s.h - 2);
    ctx2d.setLineDash([]);
    ctx2d.fillStyle = 'rgba(20,24,34,.6)';
    ctx2d.fillRect(s.x + 1, s.y + 1, s.w - 2, s.h - 2);
    ctx2d.fillStyle = 'rgba(200,210,230,.8)';
    ctx2d.font = '600 22px Inter, sans-serif';
    ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'middle';
    const t = TYPE_META[s.type].icon + '  ' + s.name + (s.needsReconnect ? ' — 다시 연결 필요' : '');
    ctx2d.fillText(t, s.x + s.w / 2, s.y + s.h / 2);
    ctx2d.restore();
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx2d.beginPath();
    ctx2d.moveTo(x + r, y);
    ctx2d.arcTo(x + w, y, x + w, y + h, r);
    ctx2d.arcTo(x + w, y + h, x, y + h, r);
    ctx2d.arcTo(x, y + h, x, y, r);
    ctx2d.arcTo(x, y, x + w, y, r);
    ctx2d.closePath();
  }
  function ellipse(s) {
    ctx2d.beginPath();
    ctx2d.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2);
  }

  // ---------- meters ----------
  function updateMeters() {
    for (const s of sources()) {
      const r = rt.get(s.id);
      if (!r || !r.analyser) continue;
      r.analyser.getByteTimeDomainData(r.meterData);
      let sum = 0;
      for (let i = 0; i < r.meterData.length; i++) { const v = (r.meterData[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / r.meterData.length);
      const amp = s.muted ? 0 : rms;
      // dB-scaled fill height (-60..0 dB -> 0..100%) matching the scale labels
      const db = amp <= 0.0001 ? -60 : Math.max(-60, Math.min(0, 20 * Math.log10(amp)));
      const pct = (db + 60) / 60 * 100;
      r.peak = Math.max(pct, (r.peak || 0) - 1.2); // peak hold with decay
      const fill = document.querySelector(`.vmeter-fill[data-src="${s.id}"]`);
      if (fill) fill.style.height = pct.toFixed(1) + '%';
      const cap = document.querySelector(`.vmeter-cap[data-src="${s.id}"]`);
      if (cap) cap.style.bottom = Math.max(0, r.peak).toFixed(1) + '%';
    }
  }

  // ============================================================
  //  OVERLAY (browser sources) + SELECTION positioning
  // ============================================================
  function displayScale() { return canvas.getBoundingClientRect().width / CW; }

  function positionOverlaysAndSelection() {
    const sc = displayScale();
    // browser source iframes
    const seen = new Set();
    for (const s of sources()) {
      if (s.type !== 'browser') continue;
      seen.add(s.id);
      let f = overlayLayer.querySelector(`iframe[data-src="${s.id}"]`);
      if (!f) {
        f = document.createElement('iframe');
        f.dataset.src = s.id; f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
        overlayLayer.appendChild(f);
      }
      if (f.dataset.url !== s.url) { f.src = s.url; f.dataset.url = s.url; }
      f.style.display = s.visible ? 'block' : 'none';
      f.style.left = s.x * sc + 'px'; f.style.top = s.y * sc + 'px';
      f.style.width = s.w * sc + 'px'; f.style.height = s.h * sc + 'px';
      f.style.opacity = s.opacity;
    }
    overlayLayer.querySelectorAll('iframe').forEach((f) => { if (!seen.has(f.dataset.src)) f.remove(); });

    // selection box + distance guides
    const s = findSource(selectedId);
    const guides = $('guides');
    if (!s || TYPE_META[s.type].noVisual) { selectionEl.hidden = true; if (guides) guides.hidden = true; return; }
    selectionEl.hidden = false;
    selectionEl.style.left = s.x * sc + 'px';
    selectionEl.style.top = s.y * sc + 'px';
    selectionEl.style.width = s.w * sc + 'px';
    selectionEl.style.height = s.h * sc + 'px';
    positionGuides(s, sc, guides);
  }

  function positionGuides(s, sc, guides) {
    if (!guides) return;
    guides.hidden = false;
    const cw = CW * sc, ch = CH * sc;
    const L = s.x * sc, R = (s.x + s.w) * sc, T = s.y * sc, B = (s.y + s.h) * sc;
    const hc = (L + R) / 2, vc = (T + B) / 2;
    // gaps in canvas pixels
    const gap = { left: Math.round(s.x), right: Math.round(CW - (s.x + s.w)), top: Math.round(s.y), bottom: Math.round(CH - (s.y + s.h)) };
    const line = (g) => guides.querySelector(`.gl[data-g="${g}"]`);
    const lab = (g) => guides.querySelector(`.glabel[data-g="${g}"]`);
    const setLine = (g, css) => Object.assign(line(g).style, css);
    const setLab = (g, x, y) => { const e = lab(g); e.textContent = gap[g] + ' px'; e.style.left = x + 'px'; e.style.top = y + 'px'; };

    setLine('left', { left: '0px', top: vc + 'px', width: L + 'px', height: '' });
    setLab('left', L / 2, vc);
    setLine('right', { left: R + 'px', top: vc + 'px', width: (cw - R) + 'px', height: '' });
    setLab('right', R + (cw - R) / 2, vc);
    setLine('top', { left: hc + 'px', top: '0px', height: T + 'px', width: '' });
    setLab('top', hc, T / 2);
    setLine('bottom', { left: hc + 'px', top: B + 'px', height: (ch - B) + 'px', width: '' });
    setLab('bottom', hc, B + (ch - B) / 2);
  }

  // ============================================================
  //  POINTER INTERACTION (move / resize on canvas)
  // ============================================================
  let dragState = null;
  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const sc = CW / rect.width;
    return { x: (e.clientX - rect.left) * sc, y: (e.clientY - rect.top) * sc };
  }
  function hitTest(p) {
    for (const s of sources()) {
      if (!s.visible || s.locked || TYPE_META[s.type].noVisual) continue;
      if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) return s;
    }
    return null;
  }

  canvasFrame.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('handle')) {
      const s = findSource(selectedId); if (!s) return;
      dragState = { mode: 'resize', h: e.target.dataset.h, s, start: canvasPoint(e), o: { ...s } };
      e.target.setPointerCapture(e.pointerId);
      return;
    }
    const p = canvasPoint(e);
    const hit = hitTest(p);
    if (hit) {
      select(hit.id);
      dragState = { mode: 'move', s: hit, start: p, o: { x: hit.x, y: hit.y } };
      canvasFrame.setPointerCapture(e.pointerId);
    } else {
      select(null);
    }
  });

  canvasFrame.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const p = canvasPoint(e);
    const dx = p.x - dragState.start.x, dy = p.y - dragState.start.y;
    const s = dragState.s;
    if (dragState.mode === 'move') {
      s.x = Math.round(dragState.o.x + dx);
      s.y = Math.round(dragState.o.y + dy);
    } else {
      const o = dragState.o, h = dragState.h;
      let { x, y, w, hgt } = { x: o.x, y: o.y, w: o.w, hgt: o.h };
      if (h.includes('e')) w = o.w + dx;
      if (h.includes('s')) hgt = o.h + dy;
      if (h.includes('w')) { w = o.w - dx; x = o.x + dx; }
      if (h.includes('n')) { hgt = o.h - dy; y = o.y + dy; }
      if (w < 20) { w = 20; if (h.includes('w')) x = o.x + o.w - 20; }
      if (hgt < 20) { hgt = 20; if (h.includes('n')) y = o.y + o.h - 20; }
      s.x = Math.round(x); s.y = Math.round(y); s.w = Math.round(w); s.h = Math.round(hgt);
    }
    syncInspectorFields(s);
  });

  function endDrag() { if (dragState) { dragState = null; save(); } }
  canvasFrame.addEventListener('pointerup', endDrag);
  canvasFrame.addEventListener('pointercancel', endDrag);

  // keyboard nudge / delete
  window.addEventListener('keydown', (e) => {
    if (/input|textarea/i.test(e.target.tagName) || e.target.isContentEditable) return;
    const s = findSource(selectedId);
    if ((e.key === 'Delete' || e.key === 'Backspace') && s) { deleteSource(s.id); e.preventDefault(); return; }
    if (!s) return;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') { s.x -= step; }
    else if (e.key === 'ArrowRight') { s.x += step; }
    else if (e.key === 'ArrowUp') { s.y -= step; }
    else if (e.key === 'ArrowDown') { s.y += step; }
    else return;
    e.preventDefault(); syncInspectorFields(s); save();
  });

  // ============================================================
  //  RENDER UI (scenes / sources / inspector / mixer)
  // ============================================================
  function renderAll() { renderSceneTabs(); renderSceneList(); renderSourceList(); renderInspector(); renderMixer(); renderStatus(); }

  function renderSceneTabs() {
    const el = $('sceneTabs'); el.innerHTML = '';
    for (const s of project.scenes) {
      const t = document.createElement('button');
      t.className = 'scene-tab' + (s.id === project.activeSceneId ? ' active' : '');
      t.innerHTML = `<span class="live-mini"></span><span>${escapeHtml(s.name)}</span>`;
      t.onclick = () => switchScene(s.id);
      el.appendChild(t);
    }
  }

  function renderSceneList() {
    const el = $('sceneList'); el.innerHTML = '';
    $('sceneCount').textContent = project.scenes.length;
    project.scenes.forEach((s) => {
      const li = document.createElement('li');
      li.className = s.id === project.activeSceneId ? 'active' : '';
      li.innerHTML = `<span class="li-ico">▣</span><span class="li-name">${escapeHtml(s.name)}</span>`;
      li.onclick = () => switchScene(s.id);
      li.ondblclick = () => editName(li.querySelector('.li-name'), (v) => { s.name = v; renderAll(); save(); });
      li.oncontextmenu = (e) => { e.preventDefault(); sceneContextMenu(s); };
      el.appendChild(li);
    });
  }

  function sceneContextMenu(s) {
    const action = prompt(`장면 "${s.name}" — 입력: rename / duplicate / delete`, 'rename');
    if (action === 'duplicate') duplicateScene(s.id);
    else if (action === 'delete') deleteScene(s.id);
    else if (action === 'rename') { const n = prompt('새 이름', s.name); if (n) { s.name = n; renderAll(); save(); } }
  }

  function renderSourceList() {
    const el = $('sourceList'); el.innerHTML = '';
    const list = sources();
    $('sourceEmpty').style.display = list.length ? 'none' : 'block';
    el.style.display = list.length ? 'block' : 'none';
    list.forEach((s, idx) => {
      const li = document.createElement('li');
      li.className = s.id === selectedId ? 'active' : '';
      li.draggable = true;
      li.dataset.idx = idx;
      li.innerHTML =
        `<button class="li-toggle ${s.visible ? '' : 'off'}" title="표시/숨김">${s.visible ? eye() : eyeOff()}</button>` +
        `<span class="li-ico">${TYPE_META[s.type].icon}</span>` +
        `<span class="li-name">${escapeHtml(s.name)}</span>` +
        `<button class="li-toggle" title="${s.locked ? '잠금 해제' : '잠금'}">${s.locked ? lock() : ''}</button>`;
      li.querySelector('.li-toggle').onclick = (e) => { e.stopPropagation(); s.visible = !s.visible; renderSourceList(); renderInspector(); save(); };
      const lockBtn = li.querySelectorAll('.li-toggle')[1];
      lockBtn.onclick = (e) => { e.stopPropagation(); s.locked = !s.locked; renderSourceList(); renderInspector(); save(); };
      li.onclick = () => select(s.id);
      li.ondblclick = () => editName(li.querySelector('.li-name'), (v) => { s.name = v; renderAll(); save(); });
      attachLayerDnD(li);
      el.appendChild(li);
    });
  }

  // layer drag-and-drop reordering
  let dndIdx = null;
  function attachLayerDnD(li) {
    li.addEventListener('dragstart', () => { dndIdx = +li.dataset.idx; li.classList.add('dragging'); });
    li.addEventListener('dragend', () => { li.classList.remove('dragging'); clearDrop(); });
    li.addEventListener('dragover', (e) => {
      e.preventDefault(); clearDrop();
      const rect = li.getBoundingClientRect();
      li.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-above' : 'drop-below');
    });
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      const rect = li.getBoundingClientRect();
      let to = +li.dataset.idx + (e.clientY < rect.top + rect.height / 2 ? 0 : 1);
      const arr = sources();
      const [moved] = arr.splice(dndIdx, 1);
      if (dndIdx < to) to--;
      arr.splice(to, 0, moved);
      clearDrop(); renderSourceList(); save();
    });
  }
  function clearDrop() { document.querySelectorAll('.layers li').forEach((n) => n.classList.remove('drop-above', 'drop-below')); }

  // ---------- INSPECTOR ----------
  function renderInspector() {
    const el = $('inspector');
    const s = findSource(selectedId);
    if (!s) { el.innerHTML = '<div class="empty-hint"><p>소스를 선택하세요.</p></div>'; return; }
    const m = TYPE_META[s.type];
    let html = `<div class="sub-head">${m.icon} ${escapeHtml(s.name)}</div>`;

    if (s.needsReconnect) {
      html += `<button class="btn btn-block btn-primary" data-act="reconnect">🔌 미디어 다시 연결</button><div style="height:12px"></div>`;
    }

    // name (all source types)
    html += `<div class="field"><label>이름</label><input class="inp" type="text" data-k="name" data-rename="1" value="${escapeHtml(s.name)}"></div>`;

    // transform (skip for audio-only)
    if (!m.noVisual) {
      html += `
      <div class="row">
        <div class="field"><label>X</label><input class="inp" type="number" data-k="x" value="${s.x}"></div>
        <div class="field"><label>Y</label><input class="inp" type="number" data-k="y" value="${s.y}"></div>
      </div>
      <div class="row">
        <div class="field"><label>너비</label><input class="inp" type="number" data-k="w" value="${s.w}"></div>
        <div class="field"><label>높이</label><input class="inp" type="number" data-k="h" value="${s.h}"></div>
      </div>
      <div class="field"><label>불투명도 <span class="range-val" data-rv="opacity">${Math.round(s.opacity*100)}%</span></label>
        <input type="range" min="0" max="1" step="0.01" data-k="opacity" value="${s.opacity}"></div>
      <div class="toggle-row">
        <button class="chip ${s.visible?'on':''}" data-toggle="visible">${s.visible?'표시':'숨김'}</button>
        <button class="chip ${s.locked?'on':''}" data-toggle="locked">${s.locked?'잠김':'잠금'}</button>
      </div>`;
    }

    if (s.type === 'text') {
      html += `<div class="sub-head">텍스트</div>
      <div class="field"><label>내용</label><textarea class="inp" data-k="text">${escapeHtml(s.text)}</textarea></div>
      <div class="row">
        <div class="field"><label>크기</label><input class="inp" type="number" data-k="size" value="${s.size}"></div>
        <div class="field"><label>색상</label><input class="inp" type="color" data-k="color" value="${s.color}"></div>
      </div>
      <div class="field"><label>정렬</label>
        <div class="toggle-row">
          ${['left','center','right'].map(a=>`<button class="chip ${s.align===a?'on':''}" data-set-align="${a}">${a==='left'?'왼쪽':a==='center'?'가운데':'오른쪽'}</button>`).join('')}
        </div></div>
      <div class="row">
        <div class="field"><label>굵기</label><select class="inp" data-k="weight">${[400,600,700,800,900].map(w=>`<option ${s.weight==w?'selected':''}>${w}</option>`).join('')}</select></div>
        <div class="field"><label>외곽선</label><button class="chip ${s.stroke?'on':''}" data-toggle="stroke" style="width:100%">${s.stroke?'켜짐':'꺼짐'}</button></div>
      </div>`;
    }

    if (s.type === 'color') {
      html += `<div class="sub-head">모양</div>
      <div class="field"><label>색상</label><input class="inp" type="color" data-k="color" value="${s.color}"></div>
      <div class="field"><label>도형</label>
        <div class="toggle-row">
          ${[['rect','사각형'],['rounded','둥근'],['ellipse','원']].map(([v,l])=>`<button class="chip ${s.shape===v?'on':''}" data-set-shape="${v}">${l}</button>`).join('')}
        </div></div>
      ${s.shape==='rounded'?`<div class="field"><label>모서리 <span class="range-val" data-rv="radius">${s.radius}px</span></label><input type="range" min="0" max="120" data-k="radius" value="${s.radius}"></div>`:''}`;
    }

    if (s.type === 'image') {
      html += `<div class="sub-head">이미지</div>
      <button class="btn btn-block" data-act="replace-image">🖼 이미지 파일 교체</button>
      <div style="height:8px"></div>
      <button class="btn btn-block" data-act="fit-natural">원본 비율 맞춤</button>`;
    }

    if (s.type === 'video') {
      html += `<div class="sub-head">재생</div>
      <div class="toggle-row">
        <button class="chip ${s.playing!==false?'on':''}" data-act="toggle-play">${s.playing!==false?'⏸ 일시정지':'▶ 재생'}</button>
        <button class="chip ${s.loop?'on':''}" data-toggle="loop">반복 ${s.loop?'켜짐':'꺼짐'}</button>
      </div>
      <button class="btn btn-block" data-act="replace-video">🎬 비디오 파일 교체</button>`;
    }

    // live capture devices: allow re-selecting the source
    if ((s.type === 'camera' || s.type === 'display' || s.type === 'audio') && !s.needsReconnect) {
      const lbl = s.type === 'display' ? '화면 다시 선택' : s.type === 'audio' ? '마이크 다시 선택' : '카메라 다시 선택';
      html += `<div class="sub-head">장치</div><button class="btn btn-block" data-act="recapture">🔄 ${lbl}</button>`;
    }

    if (s.type === 'browser') {
      html += `<div class="sub-head">브라우저</div>
      <div class="field"><label>URL</label><input class="inp" type="text" data-k="url" value="${escapeHtml(s.url)}"></div>
      <p style="font-size:11px;color:var(--text-mute)">브라우저 소스는 미리보기에만 표시되며 보안 정책상 녹화 화면에는 합성되지 않습니다.</p>`;
    }

    html += `<div style="height:14px"></div><button class="btn btn-block danger" data-act="delete">🗑 소스 삭제</button>`;
    el.innerHTML = html;
    bindInspector(el, s);
  }

  function bindInspector(el, s) {
    el.querySelectorAll('[data-k]').forEach((inp) => {
      const k = inp.dataset.k;
      const handler = () => {
        let v = inp.value;
        if (inp.type === 'number' || inp.type === 'range') v = parseFloat(v) || 0;
        s[k] = v;
        if (k === 'opacity') { const rv = el.querySelector('[data-rv=opacity]'); if (rv) rv.textContent = Math.round(v*100)+'%'; }
        if (k === 'radius') { const rv = el.querySelector('[data-rv=radius]'); if (rv) rv.textContent = v+'px'; }
        if (k === 'weight') s.weight = parseInt(v);
        if (inp.dataset.rename) { const sh = el.querySelector('.sub-head'); if (sh) sh.textContent = TYPE_META[s.type].icon + ' ' + s.name; }
        renderSourceListName(s);
        save();
      };
      inp.addEventListener('input', handler);
      inp.addEventListener('change', handler);
    });
    el.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = () => { const k=b.dataset.toggle; s[k]=!s[k]; renderInspector(); renderSourceList(); if(k==='visible'){} save(); });
    el.querySelectorAll('[data-set-align]').forEach((b) => b.onclick = () => { s.align=b.dataset.setAlign; renderInspector(); save(); });
    el.querySelectorAll('[data-set-shape]').forEach((b) => b.onclick = () => { s.shape=b.dataset.setShape; renderInspector(); save(); });
    el.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => inspectorAction(b.dataset.act, s));
  }

  function inspectorAction(act, s) {
    if (act === 'delete') deleteSource(s.id);
    else if (act === 'reconnect') reconnect(s);
    else if (act === 'toggle-play') { const r = rt.get(s.id); if (r&&r.videoEl){ if (r.videoEl.paused){r.videoEl.play(); s.playing=true;} else {r.videoEl.pause(); s.playing=false;} } renderInspector(); }
    else if (act === 'fit-natural') { const r = rt.get(s.id); if (r&&r.natW){ const sc=Math.min(640/r.natW,640/r.natH,1); s.w=Math.round(r.natW*sc); s.h=Math.round(r.natH*sc); syncInspectorFields(s); renderInspector(); save(); } }
    else if (act === 'replace-image') replaceImage(s);
    else if (act === 'replace-video') replaceVideo(s);
    else if (act === 'recapture') recaptureDevice(s);
  }

  // ----- edit content of existing sources -----
  function replaceImage(s) {
    pickFile('image/*', (file) => {
      const img = new Image();
      img.onload = () => {
        rt.set(s.id, Object.assign(rt.get(s.id) || {}, { imgEl: img, natW: img.width, natH: img.height }));
        s.needsReconnect = false;
        toast('이미지를 교체했습니다.');
        renderInspector(); save();
      };
      img.onerror = () => toast('이미지를 불러오지 못했습니다.', true);
      img.src = URL.createObjectURL(file);
    });
  }

  function replaceVideo(s) {
    pickFile('video/*', (file) => {
      const old = rt.get(s.id);
      const v = document.createElement('video');
      v.src = URL.createObjectURL(file);
      v.loop = s.loop !== false; v.playsInline = true;
      v.onloadedmetadata = () => {
        if (old && old.videoEl) { try { old.videoEl.pause(); } catch (e) {} }
        const r = rt.get(s.id) || {};
        r.videoEl = v; r._mediaNode = null; // allow re-wiring audio for the new element
        rt.set(s.id, r);
        if (s.playing !== false) v.play().catch(() => {});
        setupElementAudio(s, v);
        s.needsReconnect = false;
        toast('비디오를 교체했습니다.');
        renderInspector(); renderMixer(); save();
      };
      v.onerror = () => toast('비디오를 불러오지 못했습니다.', true);
    });
  }

  async function recaptureDevice(s) {
    const old = rt.get(s.id);
    if (old && old.stream) old.stream.getTracks().forEach((t) => t.stop());
    try {
      await addCapture(s.type, s); // re-runs getUserMedia/getDisplayMedia into the same source
      toast('장치를 다시 선택했습니다.');
      renderInspector();
    } catch (e) { toast(captureError(s.type, e), true); }
  }

  function syncInspectorFields(s) {
    if (s.id !== selectedId) return;
    const el = $('inspector');
    ['x','y','w','h'].forEach((k) => { const i = el.querySelector(`[data-k="${k}"]`); if (i && document.activeElement !== i) i.value = Math.round(s[k]); });
  }
  function renderSourceListName(s) {
    const li = [...document.querySelectorAll('#sourceList li')].find((_, i) => sources()[i] && sources()[i].id === s.id);
    if (li) li.querySelector('.li-name').textContent = s.name;
  }

  // ---------- MIXER ----------
  function renderMixer() {
    const el = $('mixerTracks');
    const audioSources = sources().filter((s) => { const r = rt.get(s.id); return r && r.hasAudio; });
    if (!audioSources.length) { el.innerHTML = '<div class="empty-hint inline"><p>오디오 소스가 없습니다. 마이크·비디오·화면 오디오를 추가하세요.</p></div>'; return; }
    el.innerHTML = '';
    const scale = [0, -6, -12, -18, -24, -30, -36, -42, -48, -54, -60];
    for (const s of audioSources) {
      const vol = s.volume ?? 1;
      const global = (s.type === 'audio' || s.type === 'display');
      const t = document.createElement('div');
      t.className = 'track';
      t.innerHTML = `
        <div class="track-head">
          <span class="track-badge ${global ? '' : 'live'}">${global ? '전역' : '활성'}</span>
          <span class="track-name">${TYPE_META[s.type].icon} ${escapeHtml(s.name)}</span>
        </div>
        <div class="track-db" data-src="${s.id}">${volToDb(vol)} dB</div>
        <div class="track-body">
          <input type="range" class="fader" min="0" max="1" step="0.01" value="${vol}" data-vol="${s.id}" title="볼륨">
          <div class="vmeter-wrap">
            <div class="vmeter"><div class="vmeter-fill" data-src="${s.id}"></div><div class="vmeter-cap" data-src="${s.id}"></div></div>
            <div class="vscale">${scale.map((n) => `<span>${n}</span>`).join('')}</div>
          </div>
        </div>
        <div class="track-foot">
          <button class="tbtn mute ${s.muted ? 'on' : ''}" data-mute="${s.id}" title="음소거">${s.muted ? icoMuteOff() : icoSpeaker()}</button>
          <button class="tbtn monitor ${s.monitor ? 'on' : ''}" data-monitor="${s.id}" title="모니터링(헤드폰)">${icoHeadphone()}</button>
        </div>`;
      el.appendChild(t);
    }
    el.querySelectorAll('[data-vol]').forEach((r) => r.oninput = () => {
      const s = findSource(r.dataset.vol); s.volume = parseFloat(r.value); applyGain(s);
      const db = el.querySelector(`.track-db[data-src="${s.id}"]`); if (db) db.textContent = volToDb(s.volume) + ' dB';
      save();
    });
    el.querySelectorAll('[data-mute]').forEach((b) => b.onclick = () => {
      const s = findSource(b.dataset.mute); s.muted = !s.muted;
      b.classList.toggle('on', s.muted); b.innerHTML = s.muted ? icoMuteOff() : icoSpeaker();
      applyGain(s); save();
    });
    el.querySelectorAll('[data-monitor]').forEach((b) => b.onclick = () => {
      const s = findSource(b.dataset.monitor); setMonitor(s, !s.monitor);
      b.classList.toggle('on', s.monitor); save();
    });
  }

  function renderStatus() {
    $('statusScene').textContent = '장면: ' + (scene() ? scene().name : '—');
    $('statusSources').textContent = '소스 ' + sources().length;
    $('resInfo').textContent = CW + '×' + CH;
  }

  // ============================================================
  //  SCENE / SOURCE OPS
  // ============================================================
  function addScene() {
    const s = { id: uid(), name: '장면 ' + (project.scenes.length + 1), sources: [] };
    project.scenes.push(s); switchScene(s.id); save();
  }
  function deleteScene(id) {
    if (project.scenes.length <= 1) { toast('마지막 장면은 삭제할 수 없습니다.'); return; }
    project.scenes = project.scenes.filter((s) => s.id !== id);
    if (project.activeSceneId === id) project.activeSceneId = project.scenes[0].id;
    renderAll(); save();
  }
  function duplicateScene(id) {
    const src = project.scenes.find((s) => s.id === id); if (!src) return;
    const copy = { id: uid(), name: src.name + ' 복사', sources: src.sources.map((x) => ({ ...x, id: uid() })) };
    // note: media runtime not duplicated (copies show reconnect for media)
    copy.sources.forEach((c) => { if (TYPE_META[c.type].media) c.needsReconnect = true; });
    const i = project.scenes.indexOf(src);
    project.scenes.splice(i + 1, 0, copy); switchScene(copy.id); save();
  }
  function switchScene(id) { project.activeSceneId = id; selectedId = null; renderAll(); }
  function deleteSource(id) {
    const r = rt.get(id);
    if (r) { if (r.stream) r.stream.getTracks().forEach((t) => t.stop()); if (r.videoEl) r.videoEl.pause(); rt.delete(id); }
    scene().sources = sources().filter((s) => s.id !== id);
    if (selectedId === id) selectedId = null;
    renderAll(); save();
  }
  function select(id) { selectedId = id; renderSourceList(); renderInspector(); }

  // ============================================================
  //  RECORDING
  // ============================================================
  let recorder = null, recChunks = [], recTimer = null, recStart = 0, recCapture = null, recTrack = null;

  function toggleRecord() {
    if (recorder) return stopRecord();
    if (!window.MediaRecorder) { toast('이 브라우저는 녹화(MediaRecorder)를 지원하지 않습니다.', true); return; }
    try {
      ensureAudio();
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

      // Manual-frame capture (captureStream(0) + requestFrame) so recording never
      // depends on the compositor; fall back to auto 30fps if unsupported.
      recCapture = canvas.captureStream(0);
      recTrack = recCapture.getVideoTracks()[0];
      if (recTrack && typeof recTrack.requestFrame === 'function') {
        captureTracks.add(recTrack);
      } else {
        recCapture.getVideoTracks().forEach((t) => t.stop());
        recCapture = canvas.captureStream(30);
        recTrack = null;
      }
      (mixDest ? mixDest.stream.getAudioTracks() : []).forEach((t) => recCapture.addTrack(t));

      const mime = pickMime();
      try {
        recorder = new MediaRecorder(recCapture, Object.assign(mime ? { mimeType: mime } : {}, { videoBitsPerSecond: 8_000_000 }));
      } catch (e1) {
        recorder = new MediaRecorder(recCapture); // let the browser pick everything
      }
      recChunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
      recorder.onerror = (e) => { toast('녹화 오류: ' + ((e.error && e.error.message) || e.type || e), true); cleanupRecUI(); recorder = null; };
      recorder.onstop = finalizeRecording;
      recorder.start(1000);

      recStart = performance.now();
      $('btnRecord').classList.add('active');
      $('btnRecord').innerHTML = '<span class="rec-square"></span> 녹화 중지';
      $('recTimer').hidden = false;
      recTimer = setInterval(updateRecTime, 250);
      toast('녹화를 시작했습니다. (' + (mime ? mime.split(';')[0] : '기본') + ')');
    } catch (e) {
      toast('녹화 시작 실패: ' + e.message, true);
      cleanupRecUI(); recorder = null;
    }
  }

  function stopRecord() {
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.requestData(); } catch (e) {}
      recorder.stop();
    }
  }

  function cleanupRecUI() {
    clearInterval(recTimer);
    $('btnRecord').classList.remove('active');
    $('btnRecord').innerHTML = '<span class="rec-square"></span> 녹화 시작';
    $('recTimer').hidden = true;
    if (recTrack) { captureTracks.delete(recTrack); recTrack = null; }
    if (recCapture) { try { recCapture.getVideoTracks().forEach((t) => t.stop()); } catch (e) {} recCapture = null; }
  }

  function finalizeRecording() {
    cleanupRecUI();
    if (!recChunks.length) { toast('녹화된 프레임이 없습니다. 소스를 추가한 뒤 다시 시도하세요.', true); recorder = null; return; }
    const blob = new Blob(recChunks, { type: recChunks[0].type || 'video/webm' });
    if (blob.size < 1024) { toast('녹화 파일이 비어 있습니다 (' + blob.size + ' bytes).', true); recorder = null; return; }
    const url = URL.createObjectURL(blob);
    const ext = (blob.type || '').includes('mp4') ? 'mp4' : 'webm';
    const a = document.createElement('a');
    a.href = url; a.download = `webstudio-recording-${stamp()}.${ext}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 5000);
    recorder = null;
    toast('녹화 저장 완료 · ' + ext.toUpperCase() + ' · ' + (blob.size / 1048576).toFixed(1) + 'MB');
  }

  function pickMime() {
    // Prefer WebM — MediaRecorder MP4 output is fragile and often unplayable.
    const c = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    return c.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  }
  function updateRecTime() {
    const s = Math.floor((performance.now() - recStart) / 1000);
    $('recTime').textContent = String((s / 60) | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function stamp() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }

  // ---------- STREAMING (browser -> WS -> ffmpeg -> RTMP) ----------
  const PRESET_URLS = {
    twitch: 'rtmp://live.twitch.tv/app/',
    youtube: 'rtmp://a.rtmp.youtube.com/live2/',
    kick: 'rtmps://fa723fc1b171.global-contribute.live-video.net/app/',
    custom: '',
  };
  let streamWs = null, streamRec = null, streamTimer = null, streamStart = 0, streaming = false;

  function toggleStream() {
    if (streaming) return stopStream(true);
    openStreamModal();
  }

  function openStreamModal() {
    // restore last-used settings (never the stream key)
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('webstudio.stream') || '{}'); } catch (e) {}
    if (saved.url) $('streamUrl').value = saved.url;
    if (saved.preset) selectPreset(saved.preset, true);
    if (saved.vBitrate) $('vBitrate').value = saved.vBitrate;
    if (saved.fps) $('streamFps').value = saved.fps;
    $('streamModalBackdrop').hidden = false;
    setTimeout(() => $('streamKey').focus(), 30);
  }
  function closeStreamModal() { $('streamModalBackdrop').hidden = true; }

  function selectPreset(preset, keepUrl) {
    document.querySelectorAll('#platformRow .chip').forEach((c) => c.classList.toggle('on', c.dataset.preset === preset));
    $('platformRow').dataset.preset = preset;
    if (!keepUrl && preset !== 'custom') $('streamUrl').value = PRESET_URLS[preset];
    $('streamUrl').readOnly = false;
  }

  function beginStreamFromModal() {
    const url = $('streamUrl').value.trim();
    const key = $('streamKey').value.trim();
    if (!/^rtmps?:\/\//i.test(url)) { toast('올바른 RTMP 주소를 입력하세요.', true); return; }
    if (!key && !url.replace(/rtmps?:\/\//i, '').includes('/')) { toast('스트림 키를 입력하세요.', true); return; }
    const cfg = {
      url, key,
      vBitrate: parseInt($('vBitrate').value),
      fps: parseInt($('streamFps').value),
      aBitrate: 160,
    };
    // persist non-secret settings only
    try {
      localStorage.setItem('webstudio.stream', JSON.stringify({
        url, preset: $('platformRow').dataset.preset || 'twitch', vBitrate: cfg.vBitrate, fps: cfg.fps,
      }));
    } catch (e) {}
    closeStreamModal();
    startStream(cfg);
  }

  function startStream(cfg) {
    try {
      ensureAudio();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const out = canvas.captureStream(cfg.fps);
      (mixDest ? mixDest.stream.getAudioTracks() : []).forEach((t) => out.addTrack(t));

      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      streamWs = new WebSocket(`${proto}//${location.host}/relay`);
      streamWs.binaryType = 'arraybuffer';

      setStreamUI('connecting');

      streamWs.onopen = () => {
        streamWs.send(JSON.stringify(cfg));
        const mime = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
          .find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
        streamRec = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: cfg.vBitrate * 1000, audioBitsPerSecond: cfg.aBitrate * 1000 });
        streamRec.ondataavailable = (e) => {
          if (e.data.size && streamWs && streamWs.readyState === 1) e.data.arrayBuffer().then((b) => streamWs.send(b));
        };
        streamRec.start(500); // 0.5s fragments for low latency
        streaming = true;
        streamStart = performance.now();
        streamTimer = setInterval(updateStreamTime, 500);
      };

      streamWs.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        handleRelayMessage(m);
      };
      streamWs.onclose = () => { if (streaming) endStream('서버 연결이 종료되었습니다.'); };
      streamWs.onerror = () => { toast('송출 서버(RTMP 릴레이)에 연결할 수 없습니다. RTMP 송출은 ffmpeg가 실행되는 별도 서버가 필요하며, 정적 호스팅(Vercel 등)에서는 지원되지 않습니다. 녹화 기능은 그대로 사용할 수 있습니다.', true); endStream(); };
    } catch (e) {
      toast('방송 시작 실패: ' + e.message, true);
      endStream();
    }
  }

  function handleRelayMessage(m) {
    if (m.type === 'connecting') setStreamUI('connecting', m.target);
    else if (m.type === 'live') { setStreamUI('live'); toast('🔴 송출을 시작했습니다 → ' + (m.target || '')); }
    else if (m.type === 'stats') {
      if (m.bitrate) $('statBitrate').textContent = Math.round(parseFloat(m.bitrate)) + ' kbps';
      if (m.fps) $('statFps').textContent = Math.round(parseFloat(m.fps)) + ' fps';
    }
    else if (m.type === 'error') { toast('송출 오류: ' + m.message, true); endStream(); }
    else if (m.type === 'ended') {
      if (streaming) { const tail = (m.log || '').split('\n').filter(Boolean).pop() || ''; toast('송출이 중단되었습니다. ' + tail, true); }
      endStream();
    }
  }

  function stopStream(userInitiated) {
    if (streamRec && streamRec.state !== 'inactive') { try { streamRec.stop(); } catch (e) {} }
    if (streamWs) { try { streamWs.close(); } catch (e) {} }
    endStream(userInitiated ? null : undefined);
  }

  function endStream(reason) {
    streaming = false;
    clearInterval(streamTimer);
    if (streamRec) { try { if (streamRec.state !== 'inactive') streamRec.stop(); } catch (e) {} streamRec = null; }
    if (streamWs) { try { streamWs.close(); } catch (e) {} streamWs = null; }
    setStreamUI('off');
    if (reason) toast(reason, true);
  }

  function setStreamUI(state, target) {
    const b = $('btnStream'), stat = $('streamStat'), badge = $('liveBadge');
    if (state === 'off') {
      b.classList.remove('active'); b.innerHTML = liveIcon() + ' 방송 시작';
      stat.hidden = true; $('statusLive').hidden = true;
    } else if (state === 'connecting') {
      b.classList.add('active'); b.innerHTML = liveIcon() + ' 방송 중지';
      stat.hidden = false; badge.textContent = '● 연결 중'; badge.classList.add('connecting');
      $('statBitrate').textContent = '0 kbps'; $('statFps').textContent = '0 fps'; $('statTime').textContent = '00:00';
    } else if (state === 'live') {
      b.classList.add('active'); b.innerHTML = liveIcon() + ' 방송 중지';
      stat.hidden = false; badge.textContent = '● LIVE'; badge.classList.remove('connecting');
      $('statusLive').hidden = false;
    }
    renderSceneTabs();
  }
  function updateStreamTime() {
    const s = Math.floor((performance.now() - streamStart) / 1000);
    $('statTime').textContent = String((s / 60) | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function screenshot() {
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a'); a.href = url; a.download = `webstudio-shot-${stamp()}.png`; a.click();
    toast('스크린샷을 저장했습니다.');
  }

  // ============================================================
  //  MISC UI helpers
  // ============================================================
  function pickFile(accept, cb) {
    fileInput.value = ''; fileInput.accept = accept;
    fileInput.onchange = () => { const f = fileInput.files[0]; if (f) cb(f); };
    fileInput.click();
  }
  function openSourceMenu() { $('sourceMenuBackdrop').hidden = false; }
  function closeSourceMenu() { $('sourceMenuBackdrop').hidden = true; }
  function editName(span, cb) {
    span.contentEditable = 'true'; span.focus();
    const sel = window.getSelection(); const rng = document.createRange(); rng.selectNodeContents(span); sel.removeAllRanges(); sel.addRange(rng);
    const done = () => { span.contentEditable = 'false'; const v = span.textContent.trim(); if (v) cb(v); span.removeEventListener('blur', done); };
    span.addEventListener('blur', done);
    span.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); span.blur(); } });
  }
  let toastT;
  function toast(msg, err) {
    const t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3400);
  }
  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const eye = () => '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  const eyeOff = () => '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 6.1A9.7 9.7 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.6M6.3 6.3A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 3.6-.7"/></svg>';
  const lock = () => '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  const liveIcon = () => '<svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 0 1 14 0"/><path d="M8 12a4 4 0 0 1 8 0"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>';
  const icoSpeaker = () => '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 9a3.5 3.5 0 0 1 0 6"/></svg>';
  const icoMuteOff = () => '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M22 9l-5 6M17 9l5 6"/></svg>';
  const icoHeadphone = () => '<svg viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4.5" height="6" rx="1.4"/><rect x="16.5" y="14" width="4.5" height="6" rx="1.4"/></svg>';

  // ============================================================
  //  WIRING
  // ============================================================
  $('btnAddScene').onclick = addScene;
  $('btnAddSource').onclick = openSourceMenu;
  $('btnAddSourceEmpty').onclick = openSourceMenu;
  $('closeSourceMenu').onclick = closeSourceMenu;
  $('sourceMenuBackdrop').onclick = (e) => { if (e.target.id === 'sourceMenuBackdrop') closeSourceMenu(); };
  document.querySelectorAll('.source-card').forEach((c) => c.onclick = () => addSource(c.dataset.type));
  $('btnRecord').onclick = toggleRecord;
  $('btnStream').onclick = toggleStream;
  $('btnScreenshot').onclick = screenshot;
  // stream modal wiring
  $('closeStreamModal').onclick = closeStreamModal;
  $('cancelStream').onclick = closeStreamModal;
  $('startStreamBtn').onclick = beginStreamFromModal;
  $('streamModalBackdrop').onclick = (e) => { if (e.target.id === 'streamModalBackdrop') closeStreamModal(); };
  document.querySelectorAll('#platformRow .chip').forEach((c) => c.onclick = () => selectPreset(c.dataset.preset));
  $('toggleKey').onclick = () => { const k = $('streamKey'); k.type = k.type === 'password' ? 'text' : 'password'; };
  $('streamKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') beginStreamFromModal(); });
  window.addEventListener('beforeunload', save);

  // ---------- boot ----------
  load();
  renderAll();
  startLoop();
  save();
  $('btnStream').innerHTML = liveIcon() + ' 방송 시작';
})();
