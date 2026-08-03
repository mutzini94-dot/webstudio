# WebStudio — 브라우저 방송 스튜디오

OBS 스타일의 웹 방송 스튜디오. 장면/소스 관리, 실시간 캔버스 합성, 드래그·리사이즈 편집,
속성 인스펙터, 오디오 믹서, **녹화**(MediaRecorder), **RTMP 송출**(ffmpeg 릴레이)을 제공합니다.

## 구조

```
public/           ← 정적 프론트엔드 (Vercel 배포 대상)
  index.html
  styles.css
  app.js
server.js         ← 로컬 개발 서버 + RTMP 릴레이 연결 (백엔드)
stream-relay.js   ← WebSocket → ffmpeg → RTMP 중계 (백엔드, Node 상시 실행 필요)
vercel.json       ← 정적 배포 설정 (outputDirectory: public)
```

## 로컬 실행

```bash
npm install
node server.js
# http://localhost:5173
```

로컬 서버는 `public/`를 정적 서빙하고, `ws://localhost:5173/relay`로 RTMP 송출 릴레이를 제공합니다.
ffmpeg는 `ffmpeg-static`로 번들되어 별도 설치가 필요 없습니다.

## Vercel 배포 (정적 프론트엔드)

```bash
npm i -g vercel
vercel login
vercel --prod
```

`vercel.json`이 `public/`를 정적 사이트로 배포합니다.

### ⚠️ 송출 기능 제약
**Vercel은 서버리스라서 상시 실행 WebSocket 서버나 ffmpeg 프로세스를 돌릴 수 없습니다.**
따라서 Vercel 배포본에서는 **녹화는 정상 동작하지만 RTMP 실시간 송출은 동작하지 않습니다.**

송출까지 쓰려면 `server.js` + `stream-relay.js`(백엔드)를 상시 실행 가능한 호스팅에 별도 배포하세요:
- Railway / Render / Fly.io / VPS 등 (Node 프로세스 + ffmpeg 실행 가능)
- 배포 후, 프론트엔드의 릴레이 접속 대상(`/relay`)을 해당 백엔드 주소로 지정하면 됩니다.
