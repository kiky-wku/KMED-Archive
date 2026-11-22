import { sb } from '../sb.js';
import { h, icon } from '../ui.js';
import { S, go } from '../app.js';
import { shell } from './shell.js';
import { rangeStats, sumParts, studyDays, hasStats } from '../data/stats.js';
import { statBar, pct } from '../blocks/stats.js';

// ─────────────────────────────────────────────
// 내 학습 : 이번 주 공부한 날 + 과목별 진행
// ─────────────────────────────────────────────
const DAY = ['일', '월', '화', '수', '목', '금', '토'];
const ymd = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10); // 한국 날짜

export function myStatsView() {
  const week = h('section', { class: 'ms-week' }, h('i', { class: 'skel', style: { height: '150px', borderRadius: '22px' } }));
  const subs = h('div', { class: 'ms-subs' }, h('i', { class: 'skel', style: { height: '120px', borderRadius: '20px' } }));
  const body = h('div', { class: 'ms' }, week, h('h2', { class: 'ms-h' }, '과목별 진도'), subs);

  // 이번 주
  studyDays(60).then((m) => {
    const now = new Date();
    const today = ymd(now);
    const start = new Date(now.getTime() - ((now.getDay() + 6) % 7) * 86400e3); // 월요일
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start.getTime() + i * 86400e3); return { k: ymd(d), d }; });
    const studied = days.filter((x) => m.get(x.k)).length;
    // 연속 공부한 날 (오늘 아직 안 했으면 어제부터)
    let streak = 0;
    for (let i = m.get(today) ? 0 : 1; i < 60; i++) { if (m.get(ymd(new Date(now.getTime() - i * 86400e3)))) streak++; else break; }
    const total = days.reduce((a, x) => a + (m.get(x.k) || 0), 0);
    week.replaceChildren(
      h('div', { class: 'ms-wtop' },
        h('div', {}, h('span', { class: 'k' }, '이번 주'), h('b', {}, `${studied}일`, h('small', {}, ' 공부'))),
        h('div', { class: 'ms-streak' + (streak ? ' on' : '') }, h('span', { class: 'fire' }, '🔥'), h('b', {}, streak), h('span', {}, '일 연속'))),
      h('div', { class: 'ms-days' }, days.map((x, i) => {
        const n = m.get(x.k) || 0;
        const st = n ? ' on' : x.k < today ? ' miss' : '';
        return h('div', { class: 'ms-d' + (x.k === today ? ' today' : '') + st, style: { animationDelay: `${i * 0.04}s` } },
          h('span', {}, DAY[x.d.getDay()]),
          h('i', { class: 'stamp' }, n ? icon('check') : x.k < today ? icon('minus') : null),
          h('em', {}, n || ''));
      })),
      h('div', { class: 'ms-foot' }, `이번 주 ${total}문제`));
  }).catch(() => week.replaceChildren(h('div', { class: 'box-empty' }, '기록을 불러오지 못했습니다')));

  // 과목별 (지금 학기)
  (async () => {
    const { data } = await sb.from('subjects').select('*, ranges(id,name,sort), blocks(kind,title,sort)').eq('grade', S.grade).eq('semester', S.sem).order('sort');
    const list = (data || []).filter((s) => hasStats((s.blocks || []).map((b) => b.kind)) && (s.ranges || []).length);
    if (!list.length) { subs.replaceChildren(h('div', { class: 'box-empty' }, '통계를 볼 과목이 없습니다')); return; }
    subs.replaceChildren(...list.map((sub, i) => {
      const ranges = sub.ranges.sort((a, b) => a.sort - b.sort);
      const el = h('button', { class: 'ms-sub', style: { animationDelay: `${i * 0.04}s` } },
        h('span', { class: 'emo' }, sub.icon || sub.name.slice(0, 1)),
        h('div', { class: 'ms-tx' }, h('b', {}, sub.name), h('div', { class: 'ms-rows' }, h('i', { class: 'skel', style: { height: '10px' } }))),
        icon('right', 'icon s'));
      el.addEventListener('click', () => go(`#/s/${sub.id}?r=${ranges[ranges.length - 1].id}&b=stats`));
      Promise.all(ranges.map((r) => rangeStats(sub, r).then((parts) => ({ r, s: sumParts(parts) })))).then((rs) => {
        const rows = el.querySelector('.ms-rows');
        rows.replaceChildren(...rs.filter((x) => x.s.total).map(({ r, s }) => h('div', { class: 'ms-r' },
          ranges.length > 1 ? h('span', { class: 'rn' }, r.name) : null, statBar(s), h('em', { title: '진도' }, `${pct(s.ok + s.no, s.total)}%`))));
        if (!rows.childNodes.length) rows.replaceChildren(h('span', { class: 'ms-none' }, '아직 문제가 없습니다'));
      }).catch(() => {});
      return el;
    }));
  })();

  return shell({ title: '내 학습', active: 'stats', body, tone: 'gray' });
}

