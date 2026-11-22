import { sb } from '../sb.js';
import { h, icon, toast, shake, busy, gradeLabel } from '../ui.js';
import { S, isAdmin, seesAll, signOut, loadMe } from '../app.js';
import { shell } from './shell.js';
import { pushRow } from './reports.js';
import { isIOS, isStandalone } from '../data/push.js';

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

  const body = h('div', { class: 'st' },
    infoBox,
    section('알림', pushRow()),
    section('비밀번호 바꾸기', pwForm),
    section('앱', installRow,
      h('button', { class: 'st-row st-btn', onclick: () => location.reload() }, h('span', { class: 'k' }, '새로고침'), h('span', { class: 'v' }), icon('right', 'icon s')),
      h('button', { class: 'st-row st-btn danger', onclick: () => signOut() }, h('span', { class: 'k' }, '로그아웃'), h('span', { class: 'v' }), icon('out', 'icon s'))),
  );
  return shell({ title: '설정', active: 'settings', body, tone: 'gray' });
}
