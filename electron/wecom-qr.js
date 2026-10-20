'use strict';
const { randomUUID } = require('crypto');
const QRCode = require('qrcode');
// Protocol verified against WecomTeam/wecom-cli src/auth/qrcode.rs.
class WecomQR {
  constructor({ onBound, onState, fetcher = fetch, interval = 3000, lifetime = 300000 }) { Object.assign(this, { onBound, onState, fetcher, interval, lifetime }); }
  cancel() { this.controller?.abort(); clearTimeout(this.timer); this.controller = null; }
  async request(url, signal) {
    const response = await this.fetcher(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
    if (!response.ok) throw Error('企业微信二维码接口返回 HTTP ' + response.status);
    const body = await response.json(); if (!body.data) throw Error('企业微信二维码接口返回格式异常'); return body.data;
  }
  async start() {
    this.cancel(); const controller = this.controller = new AbortController();
    const source = 'wecom_cli_external', plat = process.platform === 'win32' ? 2 : process.platform === 'darwin' ? 1 : 3;
    const data = await this.request(`https://work.weixin.qq.com/ai/qc/generate?source=${source}&plat=${plat}`, controller.signal);
    const url = new URL(data.auth_url);
    if (!data.scode || url.protocol !== 'https:' || url.hostname !== 'work.weixin.qq.com') throw Error('二维码地址无效，请重试');
    const token = randomUUID(), expiresAt = Date.now() + this.lifetime;
    const image = await QRCode.toDataURL(url.href, { width: 280, margin: 2 });
    if (controller.signal.aborted) throw Error('二维码已取消');
    const poll = async () => {
      if (controller.signal.aborted) return;
      if (Date.now() >= expiresAt) { this.cancel(); this.onState({ status: 'expired', text: '二维码已过期，请刷新' }); return; }
      try {
        const result = await this.request('https://work.weixin.qq.com/ai/qc/query_result?scode=' + encodeURIComponent(data.scode), controller.signal);
        if (controller.signal.aborted) return;
        if (result.status === 'success') {
          if (!result.bot_info?.botid || !result.bot_info?.secret) throw Error('扫码成功，但未取得机器人凭据');
          await this.onBound({ botId: result.bot_info.botid, secret: result.bot_info.secret });
          this.onState({ status: 'bound', text: '扫码创建成功，机器人已连接；请发送一条消息并确认接收账号' }); return;
        }
        this.onState({ status: 'waiting', text: '等待企业微信扫码并确认创建…' });
        this.timer = setTimeout(poll, this.interval);
      } catch (error) { if (!controller.signal.aborted) this.onState({ status: 'error', text: error.message }); }
    };
    this.timer = setTimeout(poll, this.interval);
    return { token, image, expiresAt };
  }
}
module.exports = { WecomQR };
