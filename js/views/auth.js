import { sb } from '../sb.js';
import { h, icon, shake, toast, gradeLabel } from '../ui.js';
import { S, loadMe, route, touch } from '../app.js';

// 아이디 → 로그인용 내부 주소 (@가 있으면 이메일 그대로)
export const ID_DOMAIN = 'yrr-study.app';
export function idToEmail(v) {
  const t = String(v || '').trim().toLowerCase();
  return t.includes('@') ? t : `${t}@${ID_DOMAIN}`;
}

// 성공 체크 : 원이 그려지고 체크가 그어짐
// 체크가 가린 동안 다음 화면으로 바꿔두고(next), 체크가 걷히면 바로 드러나게
export function doneCheck(next) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = h('div', { class: 'done', html: '<svg viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="26"/><path d="M17 29l7.5 7.5L39.5 21"/></svg>' });
  document.body.append(el);
  return new Promise((ok) => setTimeout(async () => {
    await next?.();
    el.classList.add('out');
    setTimeout(() => { el.remove(); ok(); }, 420);
  }, reduce ? 300 : 1000));
}


// 화살표 버튼 : 다 입력하면 진해지고, 누르면 스피너
function goButton(label) {
  return h('button', { class: 'go', type: 'submit', 'aria-label': label }, icon('arrow'));
}
function busy(btn, on) {
  btn.disabled = on;
  btn.replaceChildren(on ? h('i', { class: 'spin' }) : icon('arrow'));
}
function watchFilled(btn, inputs) {
  const sync = () => btn.classList.toggle('on', inputs.every((i) => i.value.trim()));
  inputs.forEach((i) => i.addEventListener('input', sync));
  sync();
}

// 로그인
export function loginView() {
  const email = h('input', { class: 'input', type: 'text', placeholder: '아이디', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
  const pw = h('input', { class: 'input', type: 'password', placeholder: '비밀번호', autocomplete: 'current-password' });
  const err = h('div', { class: 'err' });
  const btn = goButton('로그인');
  watchFilled(btn, [email, pw]);

  const card = h('form', { class: 'auth-card', novalidate: true, onsubmit: submit },
    h('img', { class: 'brand', src: 'icons/logo.png', alt: '工夫韓醫 STUDYHANI' }),
    email,
    pw,
    err,
    btn,
    h('button', { class: 'auth-link', type: 'button', onclick: () => wrap.replaceChildren(signupCard(() => wrap.replaceChildren(card))) }, '계정이 없으신가요? ', h('b', {}, '새 계정 만들기')),
  );
  const wrap = h('div', { class: 'auth' }, card);

  async function submit(e) {
    e.preventDefault();
    err.textContent = '';
    if (!email.value.trim() || !pw.value) { err.textContent = '아이디와 비밀번호를 입력하세요.'; shake(card); return; }
    busy(btn, true);
    const { error } = await sb.auth.signInWithPassword({ email: idToEmail(email.value), password: pw.value });
    if (error) {
      busy(btn, false);
      err.textContent = /invalid/i.test(error.message) ? '아이디 또는 비밀번호가 올바르지 않습니다.' : '로그인할 수 없습니다. 잠시 후 다시 시도하세요.';
      shake(card);
      // 가입 요청만 해 둔 아이디면 알려 줌
      if (/invalid/i.test(error.message)) {
        const { data } = await sb.functions.invoke('signup', { body: { action: 'status', username: email.value } }).catch(() => ({}));
        if (data?.status === 'pending') err.textContent = '가입 승인을 기다리는 아이디입니다. 관리자가 승인하면 로그인할 수 있습니다.';
        else if (data?.status === 'rejected') err.textContent = '가입 요청이 거절되었습니다. 관리자에게 문의하세요.';
      }
      return;
    }
    await loadMe();
    if (!S.profile) { busy(btn, false); err.textContent = '등록되지 않은 계정입니다.'; shake(card); return; }
    touch();
    if (S.profile.must_change_pw) { route(); return; }      // 첫 로그인은 비밀번호 변경 후에 체크
    await doneCheck(() => route({ instant: true }));
  }

  setTimeout(() => email.focus(), 400);
  return wrap;
}

// 가입 요청 : 관리자가 승인하면 여기서 정한 아이디와 비밀번호로 로그인
function signupCard(back) {
  const name = h('input', { class: 'input', type: 'text', placeholder: '이름', autocomplete: 'name', maxlength: '20' });
  const sno = h('input', { class: 'input', type: 'text', inputmode: 'numeric', maxlength: '2', placeholder: '학번 (예: 26)' });
  const grade = h('select', { class: 'input', required: true }, h('option', { value: '', disabled: true, selected: true }, '학년'),
    ...[1, 2, 3, 4, 5, 6].map((g) => h('option', { value: g }, gradeLabel(g))));
  const id = h('input', { class: 'input', type: 'text', placeholder: '아이디 (영문 소문자, 숫자)', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', maxlength: '20' });
  const pw1 = h('input', { class: 'input', type: 'password', placeholder: '비밀번호 (6자 이상)', autocomplete: 'new-password' });
  const pw2 = h('input', { class: 'input', type: 'password', placeholder: '비밀번호 확인', autocomplete: 'new-password' });
  const hp = h('input', { class: 'auth-hp', type: 'text', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
  const err = h('div', { class: 'err' });
  const btn = goButton('가입 요청 보내기');
  const inputs = [name, sno, grade, id, pw1, pw2];
  const sync = () => btn.classList.toggle('on', inputs.every((i) => String(i.value).trim()));
  inputs.forEach((i) => { i.addEventListener('input', sync); i.addEventListener('change', sync); });
  sno.addEventListener('input', () => { sno.value = sno.value.replace(/\D/g, '').slice(0, 2); });
  id.addEventListener('input', () => { id.value = id.value.toLowerCase().replace(/\s/g, ''); });

  const backBtn = h('button', { class: 'su-back', type: 'button', 'aria-label': '로그인으로', onclick: back }, icon('back'));
  const card = h('form', { class: 'auth-card su-card', novalidate: true, onsubmit: submit },
    h('img', { class: 'brand sm', src: 'icons/logo.png', alt: '工夫韓醫 STUDYHANI' }),
    h('h1', { class: 'auth-title' }, '새 계정 만들기'),
    name, sno, grade, id, pw1, pw2, hp, err, btn);

  async function submit(e) {
    e.preventDefault();
    err.textContent = '';
    const fail = (m, el) => { err.textContent = m; shake(card); el?.focus(); };
    if (!name.value.trim()) return fail('이름을 입력하세요.', name);
    if (!/^\d{2}$/.test(sno.value)) return fail('학번은 두 자리 숫자로 입력하세요. (예: 26)', sno);
    if (!grade.value) return fail('학년을 고르세요.', grade);
    if (!/^[a-z0-9_]{3,20}$/.test(id.value.trim())) return fail('아이디는 영문 소문자, 숫자, _ 로 3~20자입니다.', id);
    if (pw1.value.length < 6) return fail('비밀번호는 6자 이상이어야 합니다.', pw1);
    if (pw1.value !== pw2.value) return fail('비밀번호가 서로 다릅니다.', pw2);
    if (!(await notice())) return;
    busy(btn, true);
    const { data, error } = await sb.functions.invoke('signup', { body: {
      action: 'request', name: name.value.trim(), student_no: +sno.value, grade: +grade.value,
      username: id.value.trim(), password: pw1.value, agree: true, hp: hp.value,
    } });
    let msg = data?.error;
    if (error) { try { msg = (await error.context.json()).error; } catch { msg = '요청을 보내지 못했습니다. 잠시 후 다시 시도하세요.'; } }
    if (msg) { busy(btn, false); return fail(msg); }
    await doneCheck(() => card.replaceChildren(
      h('img', { class: 'brand sm', src: 'icons/logo.png', alt: '工夫韓醫 STUDYHANI' }),
      h('h1', { class: 'auth-title' }, '요청을 보냈습니다'),
      h('p', { class: 'su-done' }, `승인되면 ${id.value.trim()} 아이디로 로그인할 수 있습니다.`),
      h('button', { class: 'auth-link strong', type: 'button', onclick: back }, '로그인으로 돌아가기')));
    backBtn.remove();
  }
  setTimeout(() => name.focus(), 300);
  return h('div', { class: 'su-wrap' }, backBtn, card);
}

// 보내기 전 안내 : 사이렌과 함께 뜨고, 아래 동그란 체크를 눌러야 보냄
function notice() {
  return new Promise((done) => {
    let closed = false;
    const close = (ok) => {
      if (closed) return; closed = true;
      wrap.classList.remove('on');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => wrap.remove(), 320);
      done(ok);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(false); else if (e.key === 'Enter') { e.preventDefault(); close(true); } };
    const siren = h('div', { class: 'nt-siren', 'aria-hidden': 'true' },
      h('i', { class: 'nt-ray l' }), h('i', { class: 'nt-ray r' }), h('i', { class: 'nt-ray t' }),
      h('span', { class: 'nt-ic' }, icon('siren')));
    const box = h('div', { class: 'nt', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'nt-t' },
      siren,
      h('h2', { id: 'nt-t' }, '계정은 본인만 사용하세요'),
      h('p', {}, '로그인한 기기는 기록됩니다.', h('br'), '30일 안에 ', h('b', {}, '5대'), '를 넘으면 유출로 보고', h('br'), '로그인이 막힐 수 있습니다.'),
      h('button', { class: 'nt-ok', type: 'button', 'aria-label': '확인했습니다', onclick: () => close(true) }, icon('check')),
      h('span', { class: 'nt-lab' }, '확인했습니다'));
    const wrap = h('div', { class: 'gd-wrap nt-wrap', onclick: (e) => { if (e.target === wrap) close(false); } }, box);
    document.body.append(wrap);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => wrap.classList.add('on'));
  });
}

// 첫 로그인 : 비밀번호 변경 + 학번 확인
export function firstView() {
  const p = S.profile;
  const locked = p.scope === 'own' && p.student_no != null && p.role !== 'admin';
  const pw1 = h('input', { class: 'input', type: 'password', placeholder: '새 비밀번호', autocomplete: 'new-password' });
  const pw2 = h('input', { class: 'input', type: 'password', placeholder: '새 비밀번호 확인', autocomplete: 'new-password' });
  const sno = h('input', { class: 'input', type: 'text', inputmode: 'numeric', maxlength: '2', placeholder: '학번 (예: 26)', value: p.student_no ?? '', readonly: locked });
  const hint = h('div', { class: 'hint' });
  const err = h('div', { class: 'err' });
  const btn = goButton('시작');
  watchFilled(btn, [pw1, pw2, sno]);

  function showGrade() {
    const n = parseInt(sno.value, 10);
    if (!(n >= 0 && n <= 99) || sno.value.length !== 2) { hint.textContent = ''; return; }
    if (p.grade_override != null) { hint.textContent = gradeLabel(S.grade, S.sem); return; }
    const now = new Date(); const ay = now.getFullYear() - (now.getMonth() < 2 ? 1 : 0);
    const g = ay - (2000 + n) + 1;
    hint.textContent = g >= 1 && g <= 6 ? gradeLabel(g, S.sem) : '';
  }
  sno.addEventListener('input', () => { sno.value = sno.value.replace(/\D/g, ''); showGrade(); });
  showGrade();

  const card = h('form', { class: 'auth-card', novalidate: true, onsubmit: submit },
    h('img', { class: 'brand sm', src: 'icons/logo.png', alt: '工夫韓醫 STUDYHANI' }),
    h('h1', { class: 'auth-title' }, '비밀번호 변경'),
    pw1,
    pw2,
    sno,
    hint,
    err,
    btn,
  );

  async function submit(e) {
    e.preventDefault();
    err.textContent = '';
    if (pw1.value.length < 6) { err.textContent = '비밀번호는 6자 이상이어야 합니다.'; shake(card); return; }
    if (pw1.value !== pw2.value) { err.textContent = '비밀번호가 일치하지 않습니다.'; shake(card); return; }
    const n = parseInt(sno.value, 10);
    if (sno.value.length !== 2 || isNaN(n)) { err.textContent = '학번 두 자리를 입력하세요.'; shake(card); return; }
    busy(btn, true);
    const { error } = await sb.auth.updateUser({ password: pw1.value });
    if (error) {
      busy(btn, false);
      err.textContent = /different/i.test(error.message) ? '기존과 다른 비밀번호를 입력하세요.' : '비밀번호를 바꿀 수 없습니다. 다시 시도하세요.';
      shake(card);
      return;
    }
    const r = await sb.rpc('finish_first_login', { p_student_no: n });
    if (r.error) { busy(btn, false); err.textContent = '저장할 수 없습니다. 다시 시도하세요.'; shake(card); return; }
    await loadMe();
    await doneCheck(() => route({ instant: true }));
  }

  setTimeout(() => pw1.focus(), 400);
  return h('div', { class: 'auth' }, card);
}
