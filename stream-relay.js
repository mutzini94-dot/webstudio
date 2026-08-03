// ============================================================
//  WebStudio — RTMP streaming relay
//  Browser (MediaRecorder WebM) --WebSocket--> ffmpeg --> RTMP
// ============================================================
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static');

// Optional diagnostics: set RELAY_DEBUG=<path> to log the pipeline to a file.
const DBG = process.env.RELAY_DEBUG;
const dbg = (...a) => { if (DBG) try { fs.appendFileSync(DBG, a.join(' ') + '\n'); } catch (e) {} };

// Known ingest endpoints (user still supplies their own stream key).
const PRESETS = {
  twitch:  'rtmp://live.twitch.tv/app/',
  youtube: 'rtmp://a.rtmp.youtube.com/live2/',
  kick:    'rtmps://fa723fc1b171.global-contribute.live-video.net/app/',
  custom:  '',
};

function buildTarget(msg) {
  // Accept either a full rtmp URL, or preset + key.
  if (msg.url && /^rtmps?:\/\//i.test(msg.url)) {
    return msg.url.replace(/\/$/, '') + (msg.key ? '/' + msg.key : '');
  }
  const base = PRESETS[msg.preset] || '';
  if (!base) return null;
  return base + (msg.key || '');
}

function ffmpegArgs(target, opt) {
  const v = opt.vBitrate || 4500; // kbps
  const a = opt.aBitrate || 160;
  const fps = opt.fps || 30;
  return [
    '-hide_banner',
    '-fflags', '+genpts',
    '-i', 'pipe:0',                 // WebM from browser via stdin
    // --- video ---
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-profile:v', 'main',
    '-pix_fmt', 'yuv420p',
    '-g', String(fps * 2),          // keyframe every 2s
    '-r', String(fps),
    '-b:v', v + 'k',
    '-maxrate', v + 'k',
    '-bufsize', v * 2 + 'k',
    // --- audio ---
    '-c:a', 'aac',
    '-b:a', a + 'k',
    '-ar', '44100',
    // --- output ---
    '-f', 'flv',
    target,
  ];
}

// Parse ffmpeg progress lines: "frame=  120 fps= 30 ... bitrate=4500.0kbits/s ... speed=1.0x"
function parseStats(line) {
  const g = (re) => { const m = line.match(re); return m ? m[1] : null; };
  const fps = g(/fps=\s*([\d.]+)/);
  const bitrate = g(/bitrate=\s*([\d.]+)\s*kbits/);
  const speed = g(/speed=\s*([\d.]+)x/);
  const time = g(/time=\s*(\d+:\d+:\d+\.\d+)/);
  const frame = g(/frame=\s*(\d+)/);
  if (fps == null && bitrate == null && frame == null) return null;
  return { fps, bitrate, speed, time, frame };
}

function attach(server) {
  const wss = new WebSocketServer({ server, path: '/relay' });

  wss.on('connection', (ws) => {
    let ff = null;
    let started = false;
    let errBuf = '';
    let rxBytes = 0, rxChunks = 0; // DEBUG

    const send = (obj) => { try { ws.send(JSON.stringify(obj)); } catch (_) {} };

    const stop = (reason) => {
      if (ff) {
        try { ff.stdin.end(); } catch (_) {}
        try { ff.kill('SIGKILL'); } catch (_) {}
        ff = null;
      }
      if (reason) send({ type: 'stopped', reason });
    };

    ws.on('message', (data, isBinary) => {
      // First (text) message is the config; the rest is binary media.
      if (!started && !isBinary) {
        let cfg;
        try { cfg = JSON.parse(data.toString()); } catch (e) { send({ type: 'error', message: '잘못된 설정' }); return; }
        const target = buildTarget(cfg);
        if (!target) { send({ type: 'error', message: 'RTMP 주소 또는 프리셋/키가 필요합니다.' }); return; }

        started = true;
        const safe = target.replace(/\/[^/]+$/, '/••••••'); // never echo the stream key
        send({ type: 'connecting', target: safe });

        dbg('[relay] config ok, target=', safe, 'spawning ffmpeg'); // DEBUG
        ff = spawn(ffmpegPath, ffmpegArgs(target, cfg), { windowsHide: true });

        ff.stdin.on('error', (e) => dbg('[relay] stdin err', e.message)); // ignore EPIPE when killed

        ff.stderr.on('data', (d) => {
          const text = d.toString();
          errBuf = (errBuf + text).slice(-4000);
          dbg('[ffmpeg]', text.trim().split('\n').slice(-1)[0]); // DEBUG
          const stats = parseStats(text);
          if (stats) send({ type: 'stats', ...stats });
        });

        ff.on('spawn', () => send({ type: 'live', target: safe }));

        ff.on('close', (code) => {
          ff = null;
          started = false;
          // surface the tail of ffmpeg's log so failures are diagnosable
          send({ type: 'ended', code, log: errBuf.split('\n').slice(-6).join('\n') });
        });

        ff.on('error', (e) => send({ type: 'error', message: 'ffmpeg 실행 실패: ' + e.message }));
        return;
      }

      // Binary media chunk -> ffmpeg stdin
      if (isBinary && ff && ff.stdin.writable) {
        rxBytes += data.length; rxChunks++;
        if (rxChunks <= 3 || rxChunks % 10 === 0) dbg('[relay] rx chunk', rxChunks, 'total', rxBytes, 'bytes'); // DEBUG
        ff.stdin.write(data);
      } else if (isBinary) {
        dbg('[relay] DROP binary: ff=', !!ff, 'writable=', ff && ff.stdin.writable); // DEBUG
      }
    });

    ws.on('close', () => stop());
    ws.on('error', () => stop());
  });

  return wss;
}

module.exports = { attach, PRESETS };
