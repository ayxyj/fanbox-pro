'use strict';
const Zmodem = require('zmodem.js');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { once } = require('events');

function safeName(name) {
  const base = String(name || '').replace(/\\/g, '/').split('/').pop().replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/, '');
  return !base || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? 'download.bin' : base.slice(0, 180);
}

// zmodem.js 0.1.10 assumes OO and the next shell output arrive in separate
// packets. Some SSH/bastion implementations also omit OO after a valid ZFIN.
// Limit compatibility to the completed receive handshake and ANSI shell output.
function receiveFinishCompatibility(session) {
  if (session.type !== 'receive') return;
  const original = session._consume_first;
  const parseHeader = session._parse_and_consume_header;
  session._parse_and_consume_header = function () {
    if (this._got_ZFIN) return;
    return parseHeader.call(this);
  };
  const finish = () => {
    const bytes = session._input_buffer;
    if (!session._got_ZFIN || bytes.length < 2) return false;
    const oo = bytes[0] === 79 && bytes[1] === 79;
    const shell = bytes[0] === 27 && (bytes[1] === 93 || bytes[1] === 91);
    if (!oo && !shell) return false;
    session._bytes_after_OO = bytes.slice(oo ? 2 : 0);
    bytes.length = 0;
    session._on_session_end();
    return true;
  };
  session._consume_first = function () {
    if (finish()) return;
    original.call(this);
    if (!this.has_ended()) finish();
  };
}

// Operates on raw SSH bytes. File payloads never enter UTF-8 decoding or AI logs.
class SSHZmodem {
  constructor({ stream, terminal, chooseUpload, chooseDownload, progress = () => {}, idleMs = 120000 }) {
    Object.assign(this, { stream, terminal, chooseUpload, chooseDownload, progress, idleMs });
    this.closed = false;
    this.reset();
  }
  reset() {
    this.sentry = new Zmodem.Sentry({
      to_terminal: bytes => this.terminal(Buffer.from(bytes)),
      sender: bytes => { if (!this.closed) this.stream.write(Buffer.from(bytes)); },
      on_retract() {},
      on_detect: detection => {
        if (this.closed || this.job) { detection.deny(); return; }
        const session = detection.confirm();
        receiveFinishCompatibility(session);
        this.run(session).catch(() => {});
      }
    });
  }
  consume(bytes) {
    if (this.closed) return;
    try { this.sentry.consume(Array.from(bytes)); }
    catch (error) { if (this.job) this.cancel('传输协议错误：' + (error.message || error)); else { this.reset(); this.terminal(Buffer.from('\r\n[ZMODEM 数据无法解析，请重新执行 rz / sz]\r\n')); } }
  }
  input(text) {
    if (!this.job) return false;
    if (String(text).includes('\x03')) this.cancel('已取消传输');
    return true;
  }
  touch(job, choosing = false) {
    clearTimeout(job.timer);
    job.timer = setTimeout(() => this.cancel(choosing ? '文件选择超时' : '传输超过 2 分钟没有进展，已取消'), choosing ? 300000 : this.idleMs);
  }
  status(job, text, force = false) {
    if (!force && Date.now() - job.lastStatus < 1000) return;
    job.lastStatus = Date.now();
    this.terminal(Buffer.from('\r\x1b[2K[ZMODEM] ' + text.replace(/[\x00-\x1f\x7f]/g, ' ') + '\r\n'));
    this.progress({ id: job.id, direction: job.direction, status: text, transferred: job.bytes || 0, total: job.total || 0 });
  }
  cancel(reason = '已取消传输') {
    const job = this.job;
    if (!job || job.controller.signal.aborted) return;
    job.controller.abort(Error(reason));
    try { job.session.abort(); } catch {}
  }
  close() { this.cancel('SSH 连接已断开，传输取消'); this.closed = true; }
  async run(session) {
    const job = { session, controller: new AbortController(), id: randomUUID(), direction: session.type === 'send' ? 'upload' : 'download', lastStatus: 0, bytes: 0 };
    this.job = job;
    session.on('session_end', () => { if (session.aborted()) this.cancel('远端取消了传输'); });
    const signal = job.controller.signal;
    const cancelled = new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    cancelled.catch(() => {});
    const wait = promise => Promise.race([promise, cancelled]);
    const check = () => { if (signal.aborted) throw signal.reason; };
    this.touch(job, true);
    try {
      if (session.type === 'send') {
        this.status(job, '请选择要上传的文件（Ctrl+C 取消）', true);
        const files = await wait(this.chooseUpload()); check();
        if (!files?.length) throw Error('已取消选择上传文件');
        for (const filename of files) {
          check();
          const handle = await fs.promises.open(filename, 'r');
          try {
            const stat = await handle.stat(); check();
            if (!stat.isFile() || stat.size > 0xffffffff) throw Error('仅支持小于 4 GB 的普通文件');
            const name = path.basename(filename);
            job.bytes = 0; job.total = stat.size; this.touch(job);
            this.status(job, '正在上传 ' + name, true);
            const transfer = await wait(session.send_offer({ name, size: stat.size, mtime: new Date(stat.mtimeMs), mode: stat.mode & 0o777, files_remaining: files.length - files.indexOf(filename) }));
            if (!transfer) { this.status(job, '远端跳过 ' + name, true); continue; }
            const buffer = Buffer.alloc(32768);
            while (job.bytes < stat.size) {
              check();
              const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - job.bytes), job.bytes);
              if (!bytesRead) throw Error('上传文件在读取期间发生变化');
              check(); transfer.send(Array.from(buffer.subarray(0, bytesRead))); job.bytes += bytesRead;
              if (this.stream.writableNeedDrain) await wait(once(this.stream, 'drain', { signal }));
              this.touch(job); this.status(job, `${name} · ${job.bytes} / ${job.total} 字节`);
            }
            await wait(transfer.end([])); check();
            this.status(job, '上传完成：' + name, true);
          } finally { await handle.close(); }
        }
        await wait(session.close());
      } else {
        const tasks = [];
        const ended = new Promise(resolve => session.on('session_end', resolve));
        session.on('offer', offer => {
          const task = this.receive(job, offer, wait, check).catch(error => { this.cancel(error.message || String(error)); throw error; });
          task.catch(() => {}); tasks.push(task);
        });
        session.start();
        await wait(ended); await wait(Promise.all(tasks)); check();
      }
      if (session.aborted()) throw Error('远端取消了传输');
      this.status(job, '本次传输结束', true);
    } catch (error) {
      this.cancel(error.message || String(error));
      this.status(job, error.message || String(error), true);
    } finally {
      clearTimeout(job.timer);
      if (this.job === job) this.job = null;
    }
  }
  async receive(job, offer, wait, check) {
    const details = offer.get_details(), name = safeName(details.name);
    this.touch(job, true); this.status(job, '请选择保存位置：' + name, true);
    const filename = await wait(this.chooseDownload(name)); check();
    if (!filename) { this.status(job, '已跳过：' + name, true); this.touch(job); await wait(offer.skip()); return; }
    // Save to an exclusive sibling temporary file; publish only after completion.
    const temporary = path.join(path.dirname(filename), '.fanbox-zmodem-' + randomUUID() + '.part');
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx'); job.bytes = 0; job.total = details.size || 0; this.touch(job);
      await wait(offer.accept({ on_input: bytes => {
        check();
        const buffer = Buffer.from(bytes);
        if (job.bytes + buffer.length > 0xffffffff) throw Error('下载文件超过 4 GB 上限');
        let offset = 0;
        while (offset < buffer.length) offset += fs.writeSync(fd, buffer, offset, buffer.length - offset);
        job.bytes += buffer.length; this.touch(job);
        this.status(job, `${name} · ${job.bytes} / ${job.total || '?'} 字节`);
      } }));
      check();
      if (Number.isFinite(details.size) && details.size !== job.bytes) throw Error('接收文件长度不一致，未保存目标文件');
      fs.closeSync(fd); fd = undefined;
      // No await between the final cancellation check and the atomic rename.
      fs.renameSync(temporary, filename);
      this.status(job, '下载完成：' + filename, true);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temporary); } catch (e) { if (e.code !== 'ENOENT') this.status(job, '临时文件清理失败：' + temporary, true); }
    }
  }
}
module.exports = { SSHZmodem, safeName };
