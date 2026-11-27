import { h, icon, ago, toast, deviceName } from '../ui.js';
import { S } from '../app.js';
import { bio, pkSupported, pkOnDevice, pkAsked, pkLater, pkForget, pkCancelled,
  pkWarmRegister, pkRegister, pkList, pkRemove } from '../data/passkey.js';

// ─────────────────────────────────────────────
// 패스키 화면 : 전부 가운데 작은 창으로
//  - 처음 묻기 : 비밀번호로 로그인한 직후 한 번
//  - 관리 : 설정 → 빠른 로그인
// ─────────────────────────────────────────────

// 가운데 작은 창 (바깥 누르거나 Esc 로 닫힘)
function sheet(build) {
  let closed = false;
  const box = h('div', { class: 'pk', role: 'dialog', 'aria-modal': 'true' });
  const wrap = h('div', { class: 'gd-wrap pk-wrap', onclick: (e) => { if (e.target === wrap) close(); } }, box);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  let onClose = null;
  function close() {
    if (closed) return; closed = true;
    wrap.classList.remove('on');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => wrap.remove(), 320);
    onClose?.();
  }
  build(box, close, (f) => { onClose = f; });
  document.body.append(wrap);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => wrap.classList.add('on'));
  return close;
}

// 얼굴 / 지문 그림 : 스캔 줄이 위아래로 지나감
function mark(scan = true) {
  const b = bio();
  return h('div', { class: 'pk-mark' + (scan ? ' scan' : '') + (b.icon === 'finger' ? ' fp' : '') },
    icon(b.icon), scan ? h('i', { class: 'pk-line' }) : null);
}
function success(m) {
  m.className = 'pk-mark done';
  m.replaceChildren(h('span', { html: '<svg viewBox="0 0 56 56" aria-hidden="true"><path d="M16 29l8 8 16-17"/></svg>' }));
}

// 켜기 버튼 (동그란 체크) : 누르는 순간 기기 확인창
function okButton(label, run) {
  const btn = h('button', { class: 'pk-ok', type: 'button', 'aria-label': label }, icon('check'));
  btn.onclick = async () => {
    btn.disabled = true; btn.replaceChildren(h('i', { class: 'spin' }));
    try { await run(); } finally { btn.disabled = false; btn.replaceChildren(icon('check')); }
  };
  return btn;
}

// 조사 : 받침 있는 한글 이름(지문)만 을 / 으로
const jong = (n) => { const c = n.charCodeAt(n.length - 1) - 0xAC00; return c >= 0 && c < 11172 && c % 28 !== 0; };
export const ro = (n) => n + (jong(n) ? '으로' : '로');
const eul = (n) => n + (jong(n) ? '을' : '를');

const failMsg = (e) => (/not.?enabled|disabled/i.test(e?.message || '') ? '지금은 켤 수 없습니다. 잠시 후 다시 시도하세요.' : '켜지 못했습니다. 다시 시도하세요.');

// 비밀번호 로그인 직후 : 한 번만 묻기
export async function pkMaybeAsk() {
  const uid = S.user?.id;
  if (!uid || S.profile?.must_change_pw || pkOnDevice(uid) || pkAsked(uid) || !(await pkSupported())) return;
  pkWarmRegister();
  const b = bio();
  setTimeout(() => sheet((box, close, onClose) => {
    let done = false;
    onClose(() => { if (!done) pkLater(uid); });
    const m = mark();
    const p = h('p', {}, '다음부터 비밀번호 없이', h('br'), '바로 들어올 수 있습니다.');
    const title = h('h2', {}, `${ro(b.name)} 로그인할까요?`);
    const ok = okButton('켜기', async () => {
      try {
        await pkRegister(uid);
        done = true;
        success(m); title.textContent = '켰습니다';
        p.replaceChildren('다음 로그인부터 ', h('b', {}, eul(b.name)), ' 씁니다.');
        foot.remove();
        setTimeout(close, 1100);
      } catch (e) { if (!pkCancelled(e)) p.textContent = failMsg(e); }
    });
    const foot = h('div', { class: 'pk-foot' }, ok, h('span', { class: 'pk-lab' }, '켜기'),
      h('button', { class: 'pk-later', type: 'button', onclick: close }, '나중에'));
    box.append(m, title, p, foot);
  }), 650);
}

// 설정 → 빠른 로그인 줄
export function pkSettingsRow() {
  const b = bio();
  const v = h('span', { class: 'v' });
  const row = h('button', { class: 'st-row st-btn pk-row', hidden: true, onclick: () => manage(paint) },
    h('span', { class: 'k' }, b.name), v, icon('right', 'icon s'));
  const paint = () => { v.textContent = pkOnDevice(S.user?.id) ? '켜짐' : '꺼짐'; };
  pkSupported().then((ok) => { if (!ok) return; row.hidden = false; const sec = row.closest('.st-sec'); if (sec) sec.hidden = false; paint(); });
  return row;
}

// 관리 창 : 켠 기기 목록, 지우기, 이 기기 켜기
function manage(onChange) {
  const uid = S.user.id;
  const b = bio();
  if (!pkOnDevice(uid)) pkWarmRegister();
  sheet((box, close, onClose) => {
    onClose(onChange);
    const list = h('div', { class: 'pk-list' }, h('i', { class: 'spin dark' }));
    const p = h('p', {}, '비밀번호 없이 바로 들어옵니다.', h('br'), '비밀번호 로그인도 그대로 됩니다.');
    const foot = h('div', { class: 'pk-foot' });
    const m = mark(false);
    box.append(
      h('button', { class: 'pk-x', type: 'button', 'aria-label': '닫기', onclick: close }, icon('x')),
      m, h('h2', {}, `${b.name} 로그인`), p, list, foot);

    async function load() {
      let items;
      try { items = await pkList(); } catch { list.replaceChildren(h('span', { class: 'pk-empty' }, '목록을 불러오지 못했습니다.')); return; }
      if (!items.length && pkOnDevice(uid)) pkForget();
      list.replaceChildren(...(items.length ? items.map(itemRow) : [h('span', { class: 'pk-empty' }, '켠 기기가 없습니다.')]));
      foot.replaceChildren(...(pkOnDevice(uid) ? [] : [
        okButton('이 기기에서 켜기', async () => {
          try { await pkRegister(uid); success(m); toast(`${b.name} 로그인을 켰습니다`); onChange?.(); load(); }
          catch (e) { if (!pkCancelled(e)) toast(failMsg(e)); }
        }),
        h('span', { class: 'pk-lab' }, '이 기기에서 켜기')]));
    }

    function itemRow(it) {
      let armed = 0;
      const del = h('button', { class: 'pk-del', type: 'button', 'aria-label': '지우기' }, icon('trash'));
      del.onclick = async () => {
        if (Date.now() - armed > 3000) { armed = Date.now(); del.classList.add('arm'); setTimeout(() => del.classList.remove('arm'), 3000); return; }
        del.disabled = true;
        try {
          await pkRemove(it.id);
          if (it.friendly_name && it.friendly_name === deviceName().replace(/ · 앱$/, '')) pkForget();
          el.classList.add('out');
          setTimeout(load, 220);
        } catch { del.disabled = false; toast('지우지 못했습니다'); }
      };
      const used = it.last_used_at ? `${ago(it.last_used_at)} 사용` : `${new Date(it.created_at).getMonth() + 1}월 ${new Date(it.created_at).getDate()}일에 켬`;
      const el = h('div', { class: 'pk-it' },
        h('div', { class: 'pk-it-tx' }, h('b', {}, it.friendly_name || '기기'), h('span', {}, used)), del);
      return el;
    }
    load();
  });
}
