const net = require('net');

const PROTOCOL_ID    = 0x0000;
const FC_READ_INPUT  = 0x04;
const FC_READ_HOLD   = 0x03;
const FC_WRITE_ONE   = 0x06;
const FC_WRITE_MULTI = 0x10;
const EX_ILLEGAL_FN  = 0x01;
const EX_ILLEGAL_ADR = 0x02;
const EX_ILLEGAL_VAL = 0x03;

class ModbusServer {
  constructor() {
    this._server        = null;
    this._clients       = new Set();
    this._listeners     = new Set();
    this.registers      = new Uint16Array(65536); // holding registers
    this.inputRegisters = new Uint16Array(65536); // input registers (FC04, read-only from client side)
  }

  // ── Public API ──────────────────────────────────────────────────────

  onWrite(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  readWords(address, count) {
    const words = [];
    for (let i = 0; i < count; i++) {
      const addr = address + i;
      words.push(addr < 65536 ? this.registers[addr] : 0);
    }
    return words;
  }

  writeWords(address, words) {
    for (let i = 0; i < words.length; i++) {
      const addr = address + i;
      if (addr < 65536) this.registers[addr] = words[i] & 0xffff;
    }
  }

  readInputWords(address, count) {
    const words = [];
    for (let i = 0; i < count; i++) {
      const addr = address + i;
      words.push(addr < 65536 ? this.inputRegisters[addr] : 0);
    }
    return words;
  }

  writeInputWords(address, words) {
    for (let i = 0; i < words.length; i++) {
      const addr = address + i;
      if (addr < 65536) this.inputRegisters[addr] = words[i] & 0xffff;
    }
  }

  get clientCount() { return this._clients.size; }

  // Wer ist gerade verbunden? Beantwortet im Betrieb die Frage "haengt der Direktvermarkter dran?" —
  // sonst sieht man nur eine nackte Anzahl und weiss nicht, ob sie den erwarteten Peer enthaelt.
  get clients() {
    const out = [];
    for (const s of this._clients) {
      out.push({
        address: s.remoteAddress ? String(s.remoteAddress).replace(/^::ffff:/, '') : null,
        port: s.remotePort || null,
        connectedAt: s._mbConnectedAt || null,
        lastRequestAt: s._mbLastRequestAt || null,
        requestCount: s._mbRequests || 0,
        lastWriteAt: s._mbLastWriteAt || null,
      });
    }
    return out.sort((a, b) => String(a.address).localeCompare(String(b.address)));
  }
  get listening()   { return !!(this._server && this._server.listening); }

  listen(host, port) {
    if (this._server) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const srv = net.createServer((socket) => {
        this._clients.add(socket);
        socket._mbConnectedAt = new Date().toISOString();
        socket._mbRequests = 0;
        let buf = Buffer.alloc(0);

        socket.on('data', (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          while (buf.length >= 6) {
            const frameLen = 6 + buf.readUInt16BE(4);
            if (buf.length < frameLen) break;
            const frame = buf.slice(0, frameLen);
            buf = buf.slice(frameLen);
            socket._mbRequests = (socket._mbRequests || 0) + 1;
            socket._mbLastRequestAt = new Date().toISOString();
            // Schreibende Funktionscodes gesondert vermerken: nur sie belegen, dass der
            // Gegenpart wirklich Sollwerte liefert und nicht bloss die Verbindung offen haelt.
            const fc = frame.length > 7 ? frame[7] : 0;
            if (fc === 5 || fc === 6 || fc === 15 || fc === 16) {
              socket._mbLastWriteAt = socket._mbLastRequestAt;
            }
            try { this._handle(frame, socket); } catch { /* isolate per frame */ }
          }
        });

        socket.on('close', () => this._clients.delete(socket));
        socket.on('error', () => this._clients.delete(socket));
      });

      srv.once('error', reject);
      srv.listen(port, host, () => {
        srv.removeListener('error', reject);
        srv.on('error', (err) => console.error('[ModbusServer]', err.message));
        this._server = srv;
        resolve();
      });
    });
  }

  close() {
    return new Promise((resolve) => {
      if (!this._server) { resolve(); return; }
      for (const s of this._clients) { try { s.destroy(); } catch { /* ignore */ } }
      this._clients.clear();
      this._server.close(() => { this._server = null; resolve(); });
    });
  }

  // ── Frame handling ──────────────────────────────────────────────────

  _handle(frame, socket) {
    if (frame.length < 8) return;

    const txId  = frame.readUInt16BE(0);
    const proto = frame.readUInt16BE(2);
    const len   = frame.readUInt16BE(4);
    const unit  = frame.readUInt8(6);
    const fc    = frame.readUInt8(7);

    if (proto !== PROTOCOL_ID) return;
    if (frame.length < 6 + len) return;

    if (fc === FC_READ_INPUT) {
      if (len < 6) { socket.write(this._err(txId, unit, fc, EX_ILLEGAL_FN)); return; }
      const start = frame.readUInt16BE(8);
      const qty   = frame.readUInt16BE(10);
      if (qty < 1 || qty > 125)         { socket.write(this._err(txId, unit, fc, EX_ILLEGAL_VAL)); return; }
      if (start + qty > 65536)          { socket.write(this._err(txId, unit, fc, EX_ILLEGAL_ADR)); return; }

      const byteCount = qty * 2;
      const resp = Buffer.alloc(9 + byteCount);
      resp.writeUInt16BE(txId, 0);
      resp.writeUInt16BE(PROTOCOL_ID, 2);
      resp.writeUInt16BE(3 + byteCount, 4);
      resp.writeUInt8(unit, 6);
      resp.writeUInt8(FC_READ_INPUT, 7);
      resp.writeUInt8(byteCount, 8);
      for (let i = 0; i < qty; i++) resp.writeUInt16BE(this.inputRegisters[start + i] & 0xffff, 9 + i * 2);
      socket.write(resp);

    } else if (fc === FC_READ_HOLD) {
      if (len < 6) { socket.write(this._err(txId, unit, fc, EX_ILLEGAL_FN)); return; }
      const start = frame.readUInt16BE(8);
      const qty   = frame.readUInt16BE(10);
      if (qty < 1 || qty > 125)         { socket.write(this._err(txId, unit, fc, EX_ILLEGAL_VAL)); return; }
      if (start + qty > 65536)          { socket.write(this._err(txId, unit, fc, EX_ILLEGAL_ADR)); return; }

      const byteCount = qty * 2;
      const resp = Buffer.alloc(9 + byteCount);
      resp.writeUInt16BE(txId, 0);
      resp.writeUInt16BE(PROTOCOL_ID, 2);
      resp.writeUInt16BE(3 + byteCount, 4);
      resp.writeUInt8(unit, 6);
      resp.writeUInt8(FC_READ_HOLD, 7);
      resp.writeUInt8(byteCount, 8);
      for (let i = 0; i < qty; i++) resp.writeUInt16BE(this.registers[start + i] & 0xffff, 9 + i * 2);
      socket.write(resp);

    } else if (fc === FC_WRITE_ONE) {
      if (len < 6) { socket.write(this._err(txId, unit, fc, EX_ILLEGAL_FN)); return; }
      const addr  = frame.readUInt16BE(8);
      const value = frame.readUInt16BE(10);
      if (addr >= 65536) { socket.write(this._err(txId, unit, fc, EX_ILLEGAL_ADR)); return; }
      this.registers[addr] = value & 0xffff;
      socket.write(frame.slice(0, 12));
      this._emit(addr, [value]);

    } else if (fc === FC_WRITE_MULTI) {
      if (len < 7) { socket.write(this._err(txId, unit, fc, EX_ILLEGAL_FN)); return; }
      const start     = frame.readUInt16BE(8);
      const qty       = frame.readUInt16BE(10);
      const byteCount = frame.readUInt8(12);
      if (qty < 1 || qty > 123 || byteCount !== qty * 2) { socket.write(this._err(txId, unit, fc, EX_ILLEGAL_VAL)); return; }
      if (start + qty > 65536) { socket.write(this._err(txId, unit, fc, EX_ILLEGAL_ADR)); return; }

      const words = [];
      for (let i = 0; i < qty; i++) {
        const w = frame.readUInt16BE(13 + i * 2);
        this.registers[start + i] = w & 0xffff;
        words.push(w);
      }
      const resp = Buffer.alloc(12);
      resp.writeUInt16BE(txId, 0);
      resp.writeUInt16BE(PROTOCOL_ID, 2);
      resp.writeUInt16BE(6, 4);
      resp.writeUInt8(unit, 6);
      resp.writeUInt8(FC_WRITE_MULTI, 7);
      resp.writeUInt16BE(start, 8);
      resp.writeUInt16BE(qty, 10);
      socket.write(resp);
      this._emit(start, words);

    } else {
      socket.write(this._err(txId, unit, fc, EX_ILLEGAL_FN));
    }
  }

  _err(txId, unit, fc, code) {
    const buf = Buffer.alloc(9);
    buf.writeUInt16BE(txId, 0);
    buf.writeUInt16BE(PROTOCOL_ID, 2);
    buf.writeUInt16BE(3, 4);
    buf.writeUInt8(unit, 6);
    buf.writeUInt8(0x80 | fc, 7);
    buf.writeUInt8(code, 8);
    return buf;
  }

  _emit(address, words) {
    for (const fn of this._listeners) {
      try { fn(address, words); } catch { /* isolate */ }
    }
  }
}

module.exports = ModbusServer;
