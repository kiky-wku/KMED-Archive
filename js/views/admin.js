import { sb } from '../sb.js';
import { dataTab } from './admin-data.js';
import { h, icon, modal, seg, toast, shake, busy, gradeLabel, fmtDate, ago, deviceName, skelRows } from '../ui.js';
import { S, go } from '../app.js';
import { shell } from './shell.js';

// ─────────────────────────────────────────────
// 관리 화면 : 회원 · 로그인 기록 · 과목
// ─────────────────────────────────────────────
const ROLE = { admin: '관리자', writer: '작성자', student: '학생' };
const SCOPE = { all: '전체', own: '자기 학년' };
export const BLOCK_KINDS = [
  ['summary', '써머리'],
  ['jung_translate', '해석 쓰기'],
  ['hanja_r', '한자 → 훈음'],
  ['hanja_h', '훈음 → 한자'],
  ['hanja_grid', '한자 목록'],
  ['wordbook', '단어장'],
  ['um_order', '순서 맞추기'],
  ['um_answers', '문장 모음'],
  ['flash', '플래시카드'],
];
const PRESETS = [
  ['정한문형', ['jung_translate', 'hanja_r', 'hanja_h', 'hanja_grid', 'wordbook', 'summary']],
  ['엄한문형', ['hanja_r', 'hanja_h', 'hanja_grid', 'um_order', 'um_answers', 'wordbook', 'summary']],
  ['자료형', ['summary']],
];
const EMOJIS = ['📜', '🖌️', '📖', '📚', '📝', '✍️', '🌿', '🍃', '🌱', '🍵', '🫚', '🍄', '🫀', '🧠', '🫁', '🦴', '🩸', '🦷', '👁️', '💊', '💉', '🩺', '🧪', '🧬', '🔬', '⚗️', '🌡️', '☯️', '🔥', '💧', '🌊', '⛰️', '🌙', '☀️', '⭐', '🪐', '🐉', '🐢', '🦌', '🐍', '🏛️', '🎓', '🧮', '📐', '📊', '🗂️', '📌', '🔖', '💡', '🎯', '🧩', '⚖️', '🗣️', '🌏', '🇨🇳', '🇰🇷', '❤️', '🫶', '😴', '🌸'];

const academicYear = () => { const d = new Date(); return d.getFullYear() - (d.getMonth() < 2 ? 1 : 0); };
const gradeOf = (p) => p.grade_override != null
  ? p.grade_override + (academicYear() - (p.grade_set_year ?? academicYear()))
  : (p.student_no != null ? academicYear() - (2000 + p.student_no) + 1 : null);

async function callAdmin(body) {
  const { data, error } = await sb.functions.invoke('admin-users', { body });
  if (error) {
    const st = error.context?.status;
    let msg = '';
    try { const j = await error.context.json(); msg = j.error || j.message || j.msg || ''; } catch { /* 응답 본문 없음 */ }
    if (!msg) {
      if (error.name === 'FunctionsFetchError') msg = '서버 함수에 연결할 수 없습니다. (함수 미배포 또는 이름 불일치)';
      else if (st === 404) msg = '서버 함수 admin-users 를 찾을 수 없습니다. (404)';
      else if (st === 401) msg = '서버 함수 인증 실패 (401) — Verify JWT 설정을 끄세요.';
      else msg = `요청을 처리할 수 없습니다. (${st || error.name})`;
    } else if (st) msg += ` (${st})`;
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export function adminView(q) {
  const tab = q.get('t') || 'members';
  const area = h('div', { class: 'adm-area' });
  const tabs = seg([['members', '회원'], ['logs', '로그인 기록'], ['subjects', '과목'], ['data', '데이터']], tab, (v) => {
    history.replaceState(null, '', `#/admin?t=${v}`);
    show(v);
  });
  function show(v) {
    area.replaceChildren();
    area.classList.remove('swap'); void area.offsetWidth; area.classList.add('swap');
    if (v === 'members') membersTab(area);
    else if (v === 'logs') logsTab(area);
    else if (v === 'data') dataTab(area);
    else subjectsTab(area);
  }
  show(tab);

  const logo = h('button', { class: 'logo-btn', 'aria-label': '홈', onclick: () => go('#/home') },
    h('img', { class: 'logo-h', src: 'icons/logo-h.png', alt: '夜淚冷 YRR STUDY' }));
  return shell({
    title: logo, active: 'admin',
    body: h('div', {}, h('div', { class: 'page-head adm-head' }, h('h1', {}, '관리'), tabs), area),
  });
}

// ═════════════ 회원 ═════════════
async function membersTab(area) {
  const search = h('input', { class: 'search-in', type: 'search', placeholder: '이름 · 아이디 검색' });
  const add = h('button', { class: 'btn sm', onclick: () => memberModal(null, reload) }, icon('plus'), '회원 등록');
  const list = h('div', { class: 'card tbl-card' }, skelRows());
  area.append(h('div', { class: 'toolbar' }, search, add), list);

  let rows = [];
  async function reload() {
    const { data } = await sb.from('profiles').select('*').order('created_at');
    rows = data || [];
    render();
  }
  function render() {
    const k = search.value.trim().toLowerCase();
    const items = rows.filter((p) => !k || (p.name || '').toLowerCase().includes(k) || (p.username || '').includes(k));
    if (!items.length) { list.replaceChildren(h('div', { class: 'empty sm' }, rows.length ? '검색 결과가 없습니다' : '등록된 회원이 없습니다')); return; }
    list.replaceChildren(h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ['이름', '아이디', '학년', '역할', '열람', '마지막 접속'].map((t) => h('th', {}, t)))),
      h('tbody', {}, items.map((p, i) => h('tr', { style: { animationDelay: `${Math.min(i, 12) * 0.025}s` }, onclick: () => memberModal(p, reload) },
        h('td', { class: 'strong' }, p.name || '—', p.must_change_pw ? h('span', { class: 'tag' }, '첫 로그인 전') : null),
        h('td', { class: 'mono' }, p.username || p.email),
        h('td', {}, gradeLabel(gradeOf(p)) || '—'),
        h('td', {}, h('span', { class: `role r-${p.role}` }, ROLE[p.role])),
        h('td', {}, SCOPE[p.scope]),
        h('td', { class: 'sub' }, ago(p.last_seen_at) || '—'),
      ))),
    ));
  }
  search.addEventListener('input', render);
  reload();
}

async function memberModal(p, done) {
  const isNew = !p;
  const { data: subs } = await sb.from('subjects').select('id,name,icon,grade,semester').order('grade').order('semester').order('sort');
  const mine = p ? ((await sb.from('subject_writers').select('subject_id').eq('user_id', p.id)).data || []).map((x) => x.subject_id) : [];
  const picked = new Set(mine);

  const name = h('input', { class: 'input', value: p?.name || '', placeholder: '홍길동' });
  const username = h('input', { class: 'input mono', value: p?.username || '', placeholder: 'gildong26', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
  const pw = h('input', { class: 'input', type: 'text', placeholder: '6자 이상', autocomplete: 'off' });
  const sno = h('input', { class: 'input', inputmode: 'numeric', maxlength: '2', value: p?.student_no ?? '', placeholder: '26' });
  sno.addEventListener('input', () => { sno.value = sno.value.replace(/\D/g, ''); });
  const gsel = h('select', { class: 'input' }, h('option', { value: '' }, '학번으로 자동'),
    [1, 2, 3, 4, 5, 6].map((g) => h('option', { value: g, selected: p && p.grade_override != null && gradeOf(p) === g }, gradeLabel(g))));
  let role = p?.role || 'student';
  const roleSeg = seg([['student', '학생'], ['writer', '작성자'], ['admin', '관리자']], role, (v) => { role = v; writersBox.hidden = v !== 'writer'; });
  const scopeSeg = seg([['own', '자기 학년'], ['all', '전체']], p?.scope || 'own');

  const writersBox = h('div', { class: 'field span2', hidden: role !== 'writer' },
    h('label', {}, '담당 과목'),
    subs?.length
      ? h('div', { class: 'chips' }, subs.map((s) => {
        const c = h('button', { type: 'button', class: 'chipt' + (picked.has(s.id) ? ' on' : ''), onclick: () => {
          picked.has(s.id) ? picked.delete(s.id) : picked.add(s.id); c.classList.toggle('on');
        } }, `${s.icon ? s.icon + ' ' : ''}${s.name} · ${gradeLabel(s.grade, s.semester)}`);
        return c;
      }))
      : h('div', { class: 'sub' }, '등록된 과목이 없습니다'),
  );

  const err = h('div', { class: 'err' });
  const fields = h('div', { class: 'form2' },
    h('div', { class: 'field' }, h('label', {}, '이름'), name),
    h('div', { class: 'field' }, h('label', {}, '아이디'), username),
    isNew ? h('div', { class: 'field' }, h('label', {}, '초기 비밀번호'), pw) : null,
    h('div', { class: 'field' }, h('label', {}, '학번'), sno),
    h('div', { class: 'field' }, h('label', {}, '학년 직접 지정'), gsel),
    h('div', { class: 'field' }, h('label', {}, '역할'), roleSeg),
    h('div', { class: 'field' }, h('label', {}, '열람 범위'), scopeSeg),
    writersBox,
  );

  // 수정 전용 : 비밀번호 초기화 · 삭제
  let extra = null;
  if (!isNew) {
    const npw = h('input', { class: 'input', type: 'text', placeholder: '새 비밀번호 (6자 이상)', autocomplete: 'off' });
    const rbtn = h('button', { type: 'button', class: 'btn ghost sm', onclick: async () => {
      if (npw.value.length < 6) { shake(npw); return; }
      busy(rbtn, true);
      try { await callAdmin({ action: 'reset_password', user_id: p.id, password: npw.value }); toast('비밀번호를 초기화했습니다'); npw.value = ''; }
      catch (e) { toast(e.message); }
      busy(rbtn, false, '초기화');
    } }, '초기화');
    let armed = false;
    const del = h('button', { type: 'button', class: 'btn danger sm', onclick: async () => {
      if (p.id === S.user.id) { toast('본인 계정은 삭제할 수 없습니다'); return; }
      if (!armed) { armed = true; del.textContent = '한 번 더 누르면 삭제'; setTimeout(() => { armed = false; del.textContent = '회원 삭제'; }, 3000); return; }
      busy(del, true);
      try { await callAdmin({ action: 'delete', user_id: p.id }); toast('삭제했습니다'); m.close(); done(); }
      catch (e) { toast(e.message); busy(del, false, '회원 삭제'); }
    } }, '회원 삭제');
    extra = h('div', { class: 'danger-zone' },
      h('div', { class: 'field' }, h('label', {}, '비밀번호 초기화'), h('div', { class: 'row' }, npw, rbtn)),
      h('div', { class: 'meta-row' },
        h('span', { class: 'sub' }, `가입 ${fmtDate(p.created_at, false)} · 마지막 접속 ${p.last_seen_at ? fmtDate(p.last_seen_at) : '없음'}`),
        del),
    );
  }

  const save = h('button', { class: 'btn', onclick: submit }, isNew ? '등록' : '저장');
  const m = modal({ title: isNew ? '회원 등록' : p.name || p.username, wide: true, body: h('div', {}, fields, err, extra), actions: [save] });
  setTimeout(() => (isNew ? name : name).focus(), 300);

  async function submit() {
    err.textContent = '';
    const u = username.value.trim().toLowerCase();
    const s = sno.value ? parseInt(sno.value, 10) : null;
    const g = gsel.value ? parseInt(gsel.value, 10) : null;
    if (!name.value.trim()) { err.textContent = '이름을 입력하세요.'; shake(m.box); return; }
    if (!/^[a-z0-9_]{3,20}$/.test(u)) { err.textContent = '아이디는 영문 소문자·숫자·_ 3~20자입니다.'; shake(m.box); return; }
    if (isNew && pw.value.length < 6) { err.textContent = '초기 비밀번호는 6자 이상이어야 합니다.'; shake(m.box); return; }
    if (s == null && g == null) { err.textContent = '학번 또는 학년을 입력하세요.'; shake(m.box); return; }
    busy(save, true);
    try {
      let id = p?.id;
      const scope = scopeSeg.get();
      if (isNew) {
        const r = await callAdmin({ action: 'create', username: u, password: pw.value, name: name.value.trim(), student_no: s, grade_override: g, role, scope });
        id = r.id;
      } else {
        if (u !== p.username) await callAdmin({ action: 'set_username', user_id: id, username: u });
        const patch = { name: name.value.trim(), student_no: s, role, scope };
        const curG = p.grade_override != null ? gradeOf(p) : null;
        if (g !== curG) patch.grade_override = g;
        const { error } = await sb.from('profiles').update(patch).eq('id', id);
        if (error) throw new Error('저장할 수 없습니다.');
      }
      // 담당 과목
      await sb.from('subject_writers').delete().eq('user_id', id);
      if (role === 'writer' && picked.size) await sb.from('subject_writers').insert([...picked].map((sid) => ({ subject_id: sid, user_id: id })));
      toast(isNew ? '등록했습니다' : '저장했습니다');
      m.close();
      done();
    } catch (e) {
      err.textContent = e.message;
      shake(m.box);
      busy(save, false, isNew ? '등록' : '저장');
    }
  }
}

// ═════════════ 로그인 기록 ═════════════
async function logsTab(area) {
  const { data: people } = await sb.from('profiles').select('id,name,username').order('name');
  const sel = h('select', { class: 'input sel' }, h('option', { value: '' }, '전체 회원'),
    (people || []).map((p) => h('option', { value: p.id }, `${p.name || p.username}`)));
  const list = h('div', { class: 'card tbl-card' }, skelRows());
  area.append(h('div', { class: 'toolbar' }, sel), list);
  const nameOf = Object.fromEntries((people || []).map((p) => [p.id, p]));

  async function load() {
    let q = sb.from('login_logs').select('at,device,user_id').order('at', { ascending: false }).limit(300);
    if (sel.value) q = q.eq('user_id', sel.value);
    const { data } = await q;
    if (!data?.length) { list.replaceChildren(h('div', { class: 'empty sm' }, '기록이 없습니다')); return; }
    let lastDay = '';
    const body = [];
    data.forEach((r, i) => {
      const d = new Date(r.at);
      const day = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
      if (day !== lastDay) { body.push(h('tr', { class: 'day' }, h('td', { colspan: '3' }, day))); lastDay = day; }
      const p = nameOf[r.user_id] || {};
      body.push(h('tr', { style: { animationDelay: `${Math.min(i, 12) * 0.02}s` } },
        h('td', { class: 'mono w-time' }, `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`),
        h('td', { class: 'strong' }, p.name || '—', h('span', { class: 'sub mono' }, ` ${p.username || ''}`)),
        h('td', { class: 'sub' }, r.device || ''),
      ));
    });
    list.replaceChildren(h('table', { class: 'tbl logs' }, h('tbody', {}, body)));
  }
  sel.addEventListener('change', load);
  load();
}

// ═════════════ 과목 ═════════════
async function subjectsTab(area) {
  let g = S.grade || 1, s = S.sem || 1;
  const gsel = h('select', { class: 'input sel' }, [1, 2, 3, 4, 5, 6].map((x) => h('option', { value: x, selected: x === g }, gradeLabel(x))));
  const ssel = seg([[1, '1학기'], [2, '2학기']], s, (v) => { s = v; load(); });
  gsel.addEventListener('change', () => { g = parseInt(gsel.value, 10); load(); });
  const add = h('button', { class: 'btn sm', onclick: () => subjectModal(null, { grade: g, semester: s }, load) }, icon('plus'), '과목 추가');
  const list = h('div', { class: 'subj-list' });
  area.append(h('div', { class: 'toolbar' }, gsel, ssel, h('div', { class: 'sp' }), add), list);

  async function load() {
    list.replaceChildren(skelRows());
    const { data } = await sb.from('subjects').select('*, ranges(id,name,sort), blocks(kind,sort)').eq('grade', g).eq('semester', s).order('sort');
    if (!data?.length) { list.replaceChildren(h('div', { class: 'empty sm' }, '등록된 과목이 없습니다')); return; }
    list.replaceChildren(...data.map((sub, i) => h('button', { class: 'subj-row', style: { animationDelay: `${i * 0.04}s` }, onclick: () => subjectModal(sub, null, load) },
      h('div', { class: 'emo' }, sub.icon || ''),
      h('div', { class: 'main' },
        h('div', { class: 'n' }, sub.name),
        h('div', { class: 'chips' },
          (sub.ranges || []).sort((a, b) => a.sort - b.sort).map((r) => h('span', { class: 'pill' }, r.name)),
          (sub.blocks || []).sort((a, b) => a.sort - b.sort).map((b) => h('span', { class: 'pill gray' }, (BLOCK_KINDS.find((k) => k[0] === b.kind) || [0, b.kind])[1])),
        ),
      ),
      icon('right'),
    )));
  }
  load();
}

async function subjectModal(sub, defaults, done) {
  const isNew = !sub;
  let emoji = sub?.icon || '';
  const emoBtn = h('button', { type: 'button', class: 'emo-pick', 'aria-label': '이모지 선택' });
  const paintEmo = () => emoBtn.replaceChildren(emoji ? h('span', {}, emoji) : h('span', { class: 'ph' }, icon('plus')));
  paintEmo();
  emoBtn.addEventListener('click', () => openEmojiPicker(emoBtn, emoji, (v) => { emoji = v; paintEmo(); }));

  const name = h('input', { class: 'input title-in', value: sub?.name || '', placeholder: '과목 이름' });
  const gsel = h('select', { class: 'input' }, [1, 2, 3, 4, 5, 6].map((x) => h('option', { value: x, selected: x === (sub?.grade ?? defaults.grade) }, gradeLabel(x))));
  const ssel = seg([[1, '1학기'], [2, '2학기']], sub?.semester ?? defaults.semester);
  const pool = h('input', { class: 'input mono', value: sub?.progress_pool || '', placeholder: 'hanmun' });

  // 범위 (중간 · 기말 …)
  let ranges = (sub?.ranges || []).slice().sort((a, b) => a.sort - b.sort).map((r) => ({ id: r.id, name: r.name }));
  if (isNew && !ranges.length) ranges = [{ name: '중간' }, { name: '기말' }];
  const rangeBox = h('div', { class: 'rlist' });
  const drawRanges = () => rangeBox.replaceChildren(
    ...ranges.map((r, i) => {
      const inp = h('input', { class: 'input', value: r.name, oninput: (e) => { r.name = e.target.value; } });
      return h('div', { class: 'rrow' }, inp,
        h('button', { type: 'button', class: 'ib', 'aria-label': '위로', disabled: i === 0, onclick: () => { [ranges[i - 1], ranges[i]] = [ranges[i], ranges[i - 1]]; drawRanges(); } }, icon('up')),
        h('button', { type: 'button', class: 'ib', 'aria-label': '삭제', onclick: () => { ranges.splice(i, 1); drawRanges(); } }, icon('trash')));
    }),
    h('button', { type: 'button', class: 'add-line', onclick: () => { ranges.push({ name: '' }); drawRanges(); rangeBox.querySelectorAll('input').at(-1)?.focus(); } }, icon('plus'), '범위 추가'),
  );
  drawRanges();

  // 탭 (블록)
  let kinds = (sub?.blocks || []).slice().sort((a, b) => a.sort - b.sort).map((b) => b.kind);
  const blockBox = h('div', {});
  const drawBlocks = () => blockBox.replaceChildren(
    h('div', { class: 'chips presets' }, PRESETS.map(([label, ks]) => h('button', { type: 'button', class: 'chipt ghost', onclick: () => { kinds = ks.slice(); drawBlocks(); } }, label))),
    h('div', { class: 'chips' }, [...kinds.map((k) => BLOCK_KINDS.find((x) => x[0] === k)), ...BLOCK_KINDS.filter(([k]) => !kinds.includes(k))].map(([k, label]) => {
      const idx = kinds.indexOf(k);
      return h('button', { type: 'button', class: 'chipt' + (idx >= 0 ? ' on' : ''), onclick: () => {
        idx >= 0 ? kinds.splice(idx, 1) : kinds.push(k); drawBlocks();
      } }, idx >= 0 ? h('b', { class: 'ord' }, String(idx + 1)) : null, label);
    })),
  );
  drawBlocks();

  const err = h('div', { class: 'err' });
  const body = h('div', {},
    h('div', { class: 'subj-title' }, emoBtn, name),
    h('div', { class: 'form2' },
      h('div', { class: 'field' }, h('label', {}, '학년'), gsel),
      h('div', { class: 'field' }, h('label', {}, '학기'), ssel),
      h('div', { class: 'field span2' }, h('label', {}, '범위'), rangeBox),
      h('div', { class: 'field span2' }, h('label', {}, '탭 (누른 순서대로 표시)'), blockBox),
      h('div', { class: 'field' }, h('label', {}, '한자 기록 공유 그룹'), pool),
    ),
    err,
  );

  const actions = [];
  if (!isNew) {
    let armed = false;
    const del = h('button', { class: 'btn danger', onclick: async () => {
      if (!armed) { armed = true; del.textContent = '한 번 더 누르면 삭제'; setTimeout(() => { armed = false; del.textContent = '과목 삭제'; }, 3000); return; }
      busy(del, true);
      const { error } = await sb.from('subjects').delete().eq('id', sub.id);
      if (error) { toast('삭제할 수 없습니다'); busy(del, false, '과목 삭제'); return; }
      toast('삭제했습니다'); m.close(); done();
    } }, '과목 삭제');
    actions.push(del);
  }
  const save = h('button', { class: 'btn', onclick: submit }, isNew ? '추가' : '저장');
  actions.push(save);
  const m = modal({ title: isNew ? '과목 추가' : '과목 수정', wide: true, body, actions });
  if (isNew) setTimeout(() => name.focus(), 300);

  async function submit() {
    err.textContent = '';
    if (!name.value.trim()) { err.textContent = '과목 이름을 입력하세요.'; shake(m.box); return; }
    const rs = ranges.map((r) => ({ ...r, name: r.name.trim() })).filter((r) => r.name);
    if (!rs.length) { err.textContent = '범위를 하나 이상 입력하세요.'; shake(m.box); return; }
    busy(save, true);
    try {
      const row = { name: name.value.trim(), icon: emoji || null, grade: parseInt(gsel.value, 10), semester: ssel.get(), progress_pool: pool.value.trim() || null };
      let id = sub?.id;
      if (isNew) {
        const { data: mx } = await sb.from('subjects').select('sort').eq('grade', row.grade).eq('semester', row.semester).order('sort', { ascending: false }).limit(1);
        row.sort = (mx?.[0]?.sort ?? -1) + 1;
        const { data, error } = await sb.from('subjects').insert(row).select('id').single();
        if (error) throw error;
        id = data.id;
      } else {
        const { error } = await sb.from('subjects').update(row).eq('id', id);
        if (error) throw error;
      }
      // 범위 : 지운 것 삭제 → 남은 것 갱신 → 새것 추가
      const keep = rs.filter((r) => r.id).map((r) => r.id);
      const gone = (sub?.ranges || []).map((r) => r.id).filter((x) => !keep.includes(x));
      if (gone.length) await sb.from('ranges').delete().in('id', gone);
      for (const [i, r] of rs.entries()) {
        if (r.id) await sb.from('ranges').update({ name: r.name, sort: i }).eq('id', r.id);
        else await sb.from('ranges').insert({ subject_id: id, name: r.name, sort: i });
      }
      // 탭
      await sb.from('blocks').delete().eq('subject_id', id);
      if (kinds.length) {
        await sb.from('blocks').insert(kinds.map((k, i) => ({ subject_id: id, kind: k, title: BLOCK_KINDS.find((x) => x[0] === k)[1], sort: i })));
      }
      toast(isNew ? '과목을 추가했습니다' : '저장했습니다');
      m.close();
      done();
    } catch (e) {
      console.error(e);
      err.textContent = '저장할 수 없습니다. 다시 시도하세요.';
      shake(m.box);
      busy(save, false, isNew ? '추가' : '저장');
    }
  }
}

// 노션식 이모지 선택창
function openEmojiPicker(anchor, current, onPick) {
  document.querySelector('.emo-pop')?.remove();
  const custom = h('input', { class: 'input', placeholder: '직접 입력', maxlength: '8' });
  const pop = h('div', { class: 'emo-pop' },
    h('div', { class: 'emo-grid' }, EMOJIS.map((e) => h('button', { type: 'button', class: e === current ? 'on' : '', onclick: () => { onPick(e); close(); } }, e))),
    h('div', { class: 'emo-foot' }, custom,
      h('button', { type: 'button', class: 'btn sm', onclick: () => { const v = custom.value.trim(); if (v) { onPick([...v][0] === v ? v : v); close(); } } }, '적용'),
      h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { onPick(''); close(); } }, '지우기')),
  );
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - 372))}px`;
  document.body.append(pop);
  const onDoc = (e) => { if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('pointerdown', onDoc), 0);
  function close() { pop.classList.add('out'); setTimeout(() => pop.remove(), 180); document.removeEventListener('pointerdown', onDoc); }
}
