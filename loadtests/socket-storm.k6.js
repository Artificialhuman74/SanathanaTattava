/**
 * socket-storm.k6.js — 500 Socket.IO clients connect within 5 s (Part 11).
 *
 * Goals:
 *   - Server accepts all connections (no hard-limit rejections)
 *   - No memory leak: RSS stable after all clients disconnect
 *   - No crashes or uncaught errors in server logs
 *
 * k6 uses the `k6/experimental/websockets` module for WS connections.
 * Socket.IO uses a polling upgrade sequence; we connect at the raw WS level
 * (/socket.io/?EIO=4&transport=websocket) which bypasses the polling handshake.
 *
 * NOTE: k6 WebSocket support is experimental. If this fails in older k6
 * versions, upgrade to k6 ≥ 0.43.
 *
 * Usage:
 *   k6 run loadtests/socket-storm.k6.js --env BASE_URL=ws://localhost:5001
 *
 * Monitor memory separately:
 *   watch -n1 "ps aux | grep 'node src/index' | awk '{print \$6}' | head -1"
 */
import ws       from 'k6/experimental/websockets';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'ws://localhost:5001')
  .replace(/^http/, 'ws');

const connectErrors   = new Rate('connect_errors');
const cleanDisconnects = new Counter('clean_disconnects');

export const options = {
  scenarios: {
    socket_storm: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5s',  target: 500 },  // 500 clients in 5 s
        { duration: '10s', target: 500 },  // hold 10 s
        { duration: '5s',  target: 0   },  // disconnect all
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    connect_errors:   ['rate<0.05'],  // < 5 % connection failures tolerated
    clean_disconnects: ['count>0'],   // at least some clients cleanly disconnected
  },
};

export default function () {
  const url = `${BASE_URL}/socket.io/?EIO=4&transport=websocket`;

  let opened = false;
  let msgReceived = false;

  const socket = ws.connect(url, {}, function (sock) {
    sock.on('open', () => {
      opened = true;
      // Socket.IO EIO4 handshake: client sends '40' (connect packet)
      sock.send('40');
    });

    sock.on('message', (_data) => {
      msgReceived = true;
    });

    sock.on('error', (_e) => {
      connectErrors.add(1);
    });

    // Hold connection for a short burst then close cleanly
    sleep(8);
    sock.close();
  });

  const ok = check(socket, {
    'socket connected': () => opened,
  });
  connectErrors.add(!ok);

  if (opened) {
    cleanDisconnects.add(1);
  }
}
