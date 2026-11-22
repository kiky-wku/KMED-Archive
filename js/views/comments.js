import { h, icon, drawer, ago, toast, shake, skelRows } from '../ui.js';
import { S, isAdmin } from '../app.js';
import { listComments, addComment, editComment, deleteComment } from '../data/comments.js';

// ─────────────────────────────────────────────
// 자료 댓글 (오른쪽 서랍, PDF 보기 위에서도 열림)
// ─────────────────────────────────────────────
export function openComments(file, { canMod = false, onChange } = {}) {
  const list = h('div', { class: 'cm-list' }, skelRows(3, 64));
  const ta = h('textarea', { class: 'cm-in', rows: 1, maxlength: 1000, placeholder: '댓글 남기기' });
  const send = h('button', { class: 'cm-send', 'aria-label': '보내기', onclick: () => post() }, icon('send'));
  const fit = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(140, ta.scrollHeight)}px`; send.classList.toggle('on', !!ta.value.trim()); };
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); post(); } });
  const title = [file.series || (file.filename || '').replace(/\.pdf$/i, ''), file.week].filter(Boolean).join(' ');
  const body = h('div', { class: 'cm' }, h('div', { class: 'cm-file' }, icon('file', 'icon s'), h('span', {}, title)), list);
  const d = drawer({ title: '댓글', body });
  d.panel.classList.add('cm-drawer');
  [...document.querySelectorAll('.scrim')].pop()?.classList.add('scrim-top');   // 'top' 은 상단 막대 이름이라 따로
  d.panel.append(h('div', { class: 'cm-compose' }, ta, send));

  let rows = [];
  const changed = () => onChange?.(rows.length);
  listComments(file.id).then((r) => { rows = r; paint(); }).catch(() => list.replaceChildren(h('div', { class: 'rp-empty' }, '댓글을 불러오지 못했습니다')));

  function paint(scrollEnd) {
    if (!rows.length) { list.replaceChildren(h('div', { class: 'cm-empty' }, icon('chat'), h('span', {}, '궁금한 점이나 틀린 곳을 남겨 주세요'))); return; }
    list.replaceChildren(...rows.map((c, i) => item(c, i)));
    if (scrollEnd) requestAnimationFrame(() => { const b = d.panel.querySelector('.drawer-body'); b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); });
  }

  function item(c, i) {
    const mine = c.author === S.user.id;
    const txt = h('p', { class: 'cm-body' }, c.body);
    const acts = h('div', { class: 'cm-acts' });
    if (mine) acts.append(h('button', { onclick: () => edit() }, '수정'));
    if (mine || canMod || isAdmin()) {
      let armed = 0;
      const del = h('button', { class: 'del', onclick: async () => {
        if (Date.now() - armed > 2500) { armed = Date.now(); del.textContent = '한 번 더'; setTimeout(() => { if (del.isConnected) del.textContent = '지우기'; }, 2500); return; }
        try { await deleteComment(c.id); el.classList.add('gone'); setTimeout(() => { rows = rows.filter((x) => x !== c); paint(); changed(); }, 200); } catch (e) { toast(e.message || '지우지 못했습니다'); }
      } }, '지우기');
      acts.append(del);
    }
    const el = h('div', { class: 'cm-i' + (mine ? ' mine' : ''), style: { animationDelay: `${Math.min(i, 10) * 0.025}s` } },
      h('div', { class: 'avatar sm' }, (c.author_name || '?').slice(0, 1)),
      h('div', { class: 'cm-main' },
        h('div', { class: 'cm-top' }, h('b', {}, c.author_name || '알 수 없음'), h('span', {}, ago(c.created_at) + (c.edited_at ? ', 수정됨' : ''))),
        txt, acts.childNodes.length ? acts : null));
    function edit() {
      const inp = h('textarea', { class: 'cm-in edit', rows: 2, maxlength: 1000 }); inp.value = c.body;
      const save = async () => {
        const v = inp.value.trim(); if (!v) { shake(inp); return; }
        try { await editComment(c.id, v); c.body = v; c.edited_at = new Date().toISOString(); paint(); } catch (e) { toast(e.message || '고치지 못했습니다'); }
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); } if (e.key === 'Escape') { e.stopPropagation(); paint(); } });
      txt.replaceWith(inp);
      acts.replaceChildren(h('button', { onclick: () => paint() }, '취소'), h('button', { class: 'ok', onclick: save }, '저장'));
      inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
    }
    return el;
  }

  async function post() {
    const v = ta.value.trim();
    if (!v) { ta.focus(); return; }
    send.disabled = true;
    try { const c = await addComment(file.id, v); rows.push(c); ta.value = ''; fit(); paint(true); changed(); }
    catch (e) { toast(e.message || '보내지 못했습니다'); }
    send.disabled = false; ta.focus();
  }
  setTimeout(() => ta.focus(), 350);
  return d;
}
