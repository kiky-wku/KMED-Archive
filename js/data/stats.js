import { sb } from '../sb.js';
import { S } from '../app.js';
import { loadCards, uniqueCards, loadProgress, readingText } from './hanja.js';
import { loadJung, loadSentences, loadFlashAll, loadItems } from './study.js';

// ─────────────────────────────────────────────
// 학습 통계 : 과목 · 범위별로 맞음 / 틀림 / 안 푼 것
// ─────────────────────────────────────────────
export const STAT_KINDS = ['hanja_r', 'hanja_h', 'jung_translate', 'um_order', 'flash'];
export const hasStats = (kinds) => kinds.some((k) => STAT_KINDS.includes(k));

const part = (key, label, tab, ids, st, qa) => {
  const ok = ids.filter((id) => st(id) === 'ok').length;
  const wrongIds = ids.filter((id) => st(id) === 'no');
  return { key, label, tab, total: ids.length, ok, no: wrongIds.length, wrong: wrongIds.map(qa) };
};

export async function rangeStats(sub, range) {
  const kinds = (sub.blocks || []).map((b) => b.kind);
  const pool = sub.progress_pool || sub.id;
  const parts = [];
  const jobs = [];
  if (kinds.includes('hanja_r') || kinds.includes('hanja_h')) {
    jobs.push(Promise.all([loadCards(range.id), loadProgress(pool)]).then(([{ cards }, prog]) => {
      const u = uniqueCards(cards);
      const by = new Map(u.map((c) => [c.ch, c]));
      const chs = u.map((c) => c.ch);
      const qa = (ch) => ({ q: ch, a: readingText(by.get(ch)) });
      if (kinds.includes('hanja_r')) parts.push(part('hanja_r', '한자 읽기', 'hanja_r', chs, (ch) => prog.r.get(ch), qa));
      if (kinds.includes('hanja_h')) parts.push(part('hanja_h', '한자 쓰기', 'hanja_h', chs, (ch) => prog.h.get(ch), qa));
    }));
  }
  if (kinds.includes('jung_translate')) {
    jobs.push(Promise.all([loadJung(range.id), loadItems('jung')]).then(([groups, items]) => {
      const by = new Map(groups.map((g) => [g.id, g]));
      parts.push(part('jung', '해석 쓰기', 'jung_translate', groups.map((g) => g.id), (id) => items.get(id)?.status,
        (id) => ({ q: by.get(id).lines.map((l) => l.hanja).join(' '), a: by.get(id).lines.map((l) => l.translation).join(' ') })));
    }));
  }
  if (kinds.includes('um_order')) {
    jobs.push(Promise.all([loadSentences(range.id), loadItems('um_order')]).then(([sents, items]) => {
      const by = new Map(sents.map((s) => [s.id, s]));
      parts.push(part('um', '순서 맞추기', 'um_order', sents.map((s) => s.id), (id) => items.get(id)?.status,
        (id) => ({ q: by.get(id).sentence, a: by.get(id).translation })));
    }));
  }
  if (kinds.includes('flash')) {
    jobs.push(Promise.all([loadFlashAll(range.id), loadItems('flash_f'), loadItems('flash_b')]).then(([cards, f, b]) => {
      const by = new Map(cards.map((c) => [c.id, c]));
      const ids = cards.map((c) => c.id);
      parts.push(part('flash_f', '플래시카드 앞면 먼저', 'flash', ids, (id) => f.get(id)?.status, (id) => ({ q: by.get(id).front, a: by.get(id).back })));
      if (ids.some((id) => b.get(id)?.status)) parts.push(part('flash_b', '플래시카드 뒷면 먼저', 'flash', ids, (id) => b.get(id)?.status, (id) => ({ q: by.get(id).back, a: by.get(id).front })));
    }));
  }
  await Promise.all(jobs);
  const order = ['jung', 'hanja_r', 'hanja_h', 'um', 'flash_f', 'flash_b'];
  parts.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return parts;
}

export const sumParts = (parts) => parts.reduce((a, p) => ({ total: a.total + p.total, ok: a.ok + p.ok, no: a.no + p.no }), { total: 0, ok: 0, no: 0 });

// 최근 공부한 날
export async function studyDays(days = 35) {
  const from = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
  const { data } = await sb.from('study_log').select('day,n').eq('user_id', S.user.id).gte('day', from);
  return new Map((data || []).map((r) => [r.day, r.n]));
}
