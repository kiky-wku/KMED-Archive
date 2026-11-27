import { sb } from '../sb.js';
import { h, icon, toast, shake, busy, gradeLabel, ago } from '../ui.js';
import { listTokens, createToken, revokeToken, connectorUrl } from '../data/drafts.js';
import { S, isAdmin, seesAll, signOut, loadMe } from '../app.js';
import { shell } from './shell.js';
import { pushRow } from './reports.js';
import { isIOS, isStandalone } from '../data/push.js';
import { savedSize, clearSaved } from '../data/offline.js';
import { fmtSize } from '../data/files.js';
import { pkSettingsRow } from './passkey.js';

// ─────────────────────────────────────────────
// 설정 : 내 정보 · 알림 · 비밀번호 · 앱
// ─────────────────────────────────────────────
export function settingsView() {
  const p = S.profile;
  const section = (title, ...kids) => h('section', { class: 'st-sec' }, h('h2', {}, title), h('div', { class: 'st-box' }, ...kids));
  const row = (k, v, extra) => h('div', { class: 'st-row' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v), extra || null);

  // ── 내 정보 ──
  const role = isAdmin() ? '관리자' : p.role === 'writer' ? '과목 담당' : '';
  const writes = h('span', { class: 'v' }, '');
  const gradeV = h('span', {}, gradeLabel(S.grade) || '없음');
  const snoV = h('span', {}, p.student_no ? `${p.student_no}학번` : '없음');
  const me = h('div', { class: 'st-me' },
    h('div', { class: 'avatar lg' }, (p.name || p.username || '?').slice(0, 1)),
    h('div', { class: 'st-me-tx' },
      h('b', {}, p.name || p.username),
      h('span', {}, [p.username, role].filter(Boolean).join('   '))));
  const snoRow = h('div', { class: 'st-row' }, h('span', { class: 'k' }, '학번'), h('span', { class: 'v' }, snoV),
    seesAll() ? h('button', { class: 'st-link', onclick: () => editSno() }, '바꾸기') : null);
  const infoBox = section('내 정보', me, snoRow, row('학년', gradeV), p.role === 'writer' ? h('div', { class: 'st-row' }, h('span', { class: 'k' }, '담당 과목'), writes) : null,
    !seesAll() ? h('p', { class: 'st-note' }, '학년이 맞지 않으면 관리자에게 말해 주세요.') : null);
  if (p.role === 'writer') {
    sb.from('subject_writers').select('subjects(name)').eq('user_id', S.user.id).then(({ data }) => {
      writes.textContent = (data || []).map((x) => x.subjects?.name).filter(Boolean).join(', ') || '없음';
    });
  }

  // 학번 바꾸기 (전체 열람 계정)
  function editSno() {
    const inp = h('input', { class: 'st-in sm', inputmode: 'numeric', maxlength: 2, value: p.student_no || '', placeholder: '25' });
    const save = h('button', { class: 'btn sm', onclick: async () => {
      const n = parseInt(inp.value, 10);
      if (inp.value.length !== 2 || isNaN(n)) { shake(inp); return; }
      busy(save, true);
      const { error } = await sb.rpc('set_my_student_no', { p_student_no: n });
      if (error) { busy(save, false, '저장'); toast('저장하지 못했습니다'); return; }
      await loadMe();
      snoV.textContent = `${S.profile.student_no}학번`; gradeV.textContent = gradeLabel(S.grade) || '없음';
      snoRow.replaceChildren(h('span', { class: 'k' }, '학번'), h('span', { class: 'v' }, snoV), h('button', { class: 'st-link', onclick: () => editSno() }, '바꾸기'));
      toast('학번을 바꿨습니다');
    } }, '저장');
    inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, ''); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
    snoRow.replaceChildren(h('span', { class: 'k' }, '학번'), h('span', { class: 'v' }, inp), save);
    inp.focus(); inp.select();
  }

  // ── 비밀번호 ──
  const cur = h('input', { class: 'st-in', type: 'password', autocomplete: 'current-password', placeholder: '지금 비밀번호' });
  const pw1 = h('input', { class: 'st-in', type: 'password', autocomplete: 'new-password', placeholder: '새 비밀번호 (6자 이상)' });
  const pw2 = h('input', { class: 'st-in', type: 'password', autocomplete: 'new-password', placeholder: '새 비밀번호 한 번 더' });
  const err = h('div', { class: 'err' });
  const pwBtn = h('button', { class: 'btn sm', type: 'submit' }, '바꾸기');
  const pwForm = h('form', { class: 'st-pw', novalidate: true, onsubmit: changePw }, cur, pw1, pw2, h('div', { class: 'st-pw-foot' }, err, pwBtn));
  async function changePw(e) {
    e.preventDefault(); err.textContent = '';
    if (!cur.value) { err.textContent = '지금 비밀번호를 입력하세요.'; shake(pwForm); return; }
    if (pw1.value.length < 6) { err.textContent = '새 비밀번호는 6자 이상이어야 합니다.'; shake(pwForm); return; }
    if (pw1.value !== pw2.value) { err.textContent = '새 비밀번호가 서로 다릅니다.'; shake(pwForm); return; }
    if (pw1.value === cur.value) { err.textContent = '지금과 다른 비밀번호를 입력하세요.'; shake(pwForm); return; }
    busy(pwBtn, true);
    // 지금 비밀번호 확인
    const chk = await sb.auth.signInWithPassword({ email: p.email, password: cur.value });
    if (chk.error) { busy(pwBtn, false, '바꾸기'); err.textContent = '지금 비밀번호가 맞지 않습니다.'; shake(pwForm); return; }
    const { error } = await sb.auth.updateUser({ password: pw1.value });
    busy(pwBtn, false, '바꾸기');
    if (error) { err.textContent = '비밀번호를 바꿀 수 없습니다. 다시 시도하세요.'; shake(pwForm); return; }
    cur.value = pw1.value = pw2.value = '';
    toast('비밀번호를 바꿨습니다');
  }

  // ── 앱 ──
  const installRow = !isStandalone()
    ? h('div', { class: 'st-tip' }, icon('download', 'icon s'),
      h('span', {}, isIOS ? '사파리 아래쪽 공유 버튼을 누르고 홈 화면에 추가를 고르면 앱처럼 쓸 수 있습니다.' : '브라우저 메뉴에서 앱 설치 또는 홈 화면에 추가를 고르면 앱처럼 쓸 수 있습니다.'))
    : null;

  const body = h('div', { class: 'stg' },
    infoBox,
    section('알림', pushRow()),
    p.role === 'writer' || isAdmin() ? section('Claude 연결', claudeBox()) : null,
    Object.assign(section('빠른 로그인', pkSettingsRow()), { hidden: true }),
    section('비밀번호 바꾸기', pwForm),
    section('앱', installRow, savedRow(),
      h('button', { class: 'st-row st-btn', onclick: () => location.reload() }, h('span', { class: 'k' }, '새로고침'), h('span', { class: 'v' }), icon('right', 'icon s')),
      h('button', { class: 'st-row st-btn danger', onclick: () => signOut() }, h('span', { class: 'k' }, '로그아웃'), h('span', { class: 'v' }), icon('out', 'icon s'))),
  );
  return shell({ title: '설정', active: 'settings', body, tone: 'gray' });
}

// 이 기기에 저장된 자료 (인터넷 없이 열기용)
function savedRow() {
  const v = h('span', { class: 'v' });
  const btn = h('button', { class: 'st-link' }, '비우기');
  const paint = () => { const { count, bytes } = savedSize(); v.textContent = count ? `${count}개, ${fmtSize(bytes)}` : '없음'; btn.style.display = count ? '' : 'none'; };
  let armed = 0;
  btn.addEventListener('click', async () => {
    if (Date.now() - armed > 2500) { armed = Date.now(); btn.textContent = '한 번 더'; setTimeout(() => { btn.textContent = '비우기'; }, 2500); return; }
    await clearSaved(); paint(); btn.textContent = '비우기'; toast('저장된 자료를 비웠습니다');
  });
  paint();
  return h('div', { class: 'st-row' }, h('span', { class: 'k' }, '저장된 자료'), v, btn);
}

// Claude 연결 : 연결 주소(열쇠) 만들기와 끊기. 주소는 만든 순간 한 번만 보임
function claudeBox() {
  const box = h('div', { class: 'cl-box' });
  let fresh = null; // 방금 만든 열쇠
  const copy = async (text, btn) => {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text); document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
    }
    btn.classList.add('ok'); btn.lastChild.textContent = '복사됨';
    setTimeout(() => { if (btn.isConnected) { btn.classList.remove('ok'); btn.lastChild.textContent = '주소 복사'; } }, 2200);
  };
  async function paint() {
    let list = [];
    try { list = await listTokens(); } catch { box.replaceChildren(h('p', { class: 'st-note' }, 'SQL 25를 실행하면 쓸 수 있습니다.')); return; }
    const rows = list.map((t) => {
      const off = h('button', { class: 'st-link danger' }, '끊기');
      let armed = 0;
      off.addEventListener('click', async () => {
        if (Date.now() - armed > 2500) { armed = Date.now(); off.textContent = '한 번 더'; setTimeout(() => { if (off.isConnected) off.textContent = '끊기'; }, 2500); return; }
        try { await revokeToken(t.id); toast('연결을 끊었습니다'); if (fresh?.hint === t.hint) fresh = null; paint(); } catch { toast('끊지 못했습니다'); }
      });
      return h('div', { class: 'st-row' }, h('span', { class: 'k' }, `…${t.hint}`),
        h('span', { class: 'v' }, t.last_used ? `${ago(t.last_used)} 사용` : '아직 안 씀'), off);
    });
    const make = h('button', { class: 'st-row st-btn', onclick: async () => {
      try { const key = await createToken(); fresh = { key, hint: key.slice(-4) }; paint(); } catch { toast(list.length >= 3 ? '연결 주소는 3개까지 만들 수 있습니다' : '만들지 못했습니다'); }
    } }, h('span', { class: 'k' }, list.length ? '새 주소' : '연결 주소'), h('span', { class: 'v' }, list.length ? '' : '만들어서 Claude에 등록합니다'), icon('plus', 'icon s'));
    const shown = fresh ? (() => {
      const url = connectorUrl(fresh.key);
      const cbtn = h('button', { class: 'cl-copy', onclick: (e) => copy(url, e.currentTarget) }, icon('copy', 'icon s'), h('span', {}, '주소 복사'));
      return h('div', { class: 'cl-new' },
        h('div', { class: 'cl-url' }, h('code', {}, url), cbtn),
        h('p', { class: 'cl-warn' }, '이 주소는 지금만 보입니다. 비밀번호처럼 다른 사람에게 보여 주지 마세요. 잃어버리면 끊고 새로 만들면 됩니다.'),
        h('ol', { class: 'cl-steps' },
          h('li', {}, 'claude.ai 설정의 커넥터에서 커스텀 커넥터 추가를 누릅니다.'),
          h('li', {}, '이름은 공부하니, 주소 칸에 복사한 주소를 붙여넣고 추가합니다.'),
          h('li', {}, '채팅 입력창의 + 에서 커넥터를 열고 공부하니를 켭니다.'),
          h('li', {}, 'PDF를 올리고 "공부하니에 의학용어 기말 플래시카드 만들어 줘" 처럼 부탁합니다.'),
          h('li', {}, '다 만들면 과목 화면 위 검토 대기에서 확인하고 넣습니다.')));
    })() : null;
    box.replaceChildren(...[...rows, list.length < 3 ? make : null, shown,
      !list.length && !fresh ? h('p', { class: 'st-note' }, 'Claude 채팅에서 만든 카드와 문제를 엑셀 없이 앱으로 바로 보냅니다. 보낸 데이터는 검토 대기에 들어가고, 확인한 뒤에 넣어야 반영됩니다.') : null].filter(Boolean));
  }
  paint();
  return box;
}
