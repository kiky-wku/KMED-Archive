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
    h('img', { class: 'brand', src: 'icons/logo.png', alt: '工夫韓醫 YRR STUDY' }),
    email,
    pw,
    err,
    btn,
  );

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
      return;
    }
    await loadMe();
    if (!S.profile) { busy(btn, false); err.textContent = '등록되지 않은 계정입니다.'; shake(card); return; }
    touch();
    if (S.profile.must_change_pw) { route(); return; }      // 첫 로그인은 비밀번호 변경 후에 체크
    await doneCheck(() => route({ instant: true }));
  }

  setTimeout(() => email.focus(), 400);
  return h('div', { class: 'auth' }, card);
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
    h('img', { class: 'brand sm', src: 'icons/logo.png', alt: '工夫韓醫 YRR STUDY' }),
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
