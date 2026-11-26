// @ts-nocheck
// 공부하니 전용 Claude 커넥터 (원격 MCP 서버)
//  - Claude 채팅에서 만든 데이터를 "검토 대기"(import_drafts) 로만 올림. 실제 데이터는 앱에서 확인하고 넣어야 바뀜
//  - 할 수 있는 것 : 내가 담당하는 과목 보기, 만드는 규칙 받기, 자료 파일 이름 보기, 검토 대기에 올리기
//  - 못 하는 것 : 지우기, 고치기, 회원 정보 보기
//  - 열쇠 : 앱 설정에서 만든 kmed_ 로 시작하는 열쇠. 주소의 ?key= 또는 Authorization: Bearer 로 받음 (DB 에는 sha256 만)
//  - 배포할 때 "Verify JWT" 는 꺼야 함 (Claude 는 Supabase 로그인 토큰이 없음)
import { createClient } from 'jsr:@supabase/supabase-js@2';

const VERSION = '1.1.0';
const APP_URL = (Deno.env.get('APP_URL') || 'https://kiky-wku.github.io/KMED-Archive').replace(/\/$/, '');
const LIMIT = { rows: 3000, bytes: 2_000_000, pending: 20 };

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

// ── 앱의 형식 규칙(formats.js) 을 그대로 씀 : 앱에서 프롬프트를 고치면 여기도 같이 바뀜 ──
type Fmt = { FORMATS: Record<string, { sheet: string; label: string; cols: [string, string][] }>; formatsFor: (k: string[]) => string[];
  buildRequest: (k: string[], o: { subject: string; range: string }) => string;
  buildPastRequest: (o: { subject: string; range: string }) => string;
  buildPredRequest: (o: { subject: string; range: string; past: unknown[] }) => string };
let fmtCache: { at: number; f: Fmt } | null = null;
async function formats(): Promise<Fmt> {
  if (fmtCache && Date.now() - fmtCache.at < 5 * 60_000) return fmtCache.f;
  let f = bundledFormats() as unknown as Fmt;
  try {
    const r = await fetch(`${APP_URL}/js/data/formats.js?t=${Date.now()}`);
    if (r.ok) {
      const src = (await r.text()).replace(/^export\s+/gm, '');
      // formats.js 는 다른 모듈을 쓰지 않는 순수 함수 묶음
      f = new Function(`${src}\nreturn { FORMATS, formatsFor, buildRequest, buildPastRequest, buildPredRequest };`)() as Fmt;
    }
  } catch { /* 배포 때 묶인 규칙 사용 */ }
  fmtCache = { at: Date.now(), f };
  return f;
}

async function sha256(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// 엑셀 붙여넣기와 같은 TSV (앱의 parseTSV 가 그대로 읽음)
const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toTSV = (rows: unknown[][]) => rows.map((r) => r.map(cell).join('\t')).join('\n');

const TOOLS = [
  {
    name: 'list_subjects',
    description: '내가 담당하는 과목과 범위(중간, 기말 등), 과목마다 넣을 수 있는 데이터 종류를 보여 줍니다. 가장 먼저 부르세요. subject_id, range_id 는 여기서 받습니다.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_instructions',
    description: '데이터를 만드는 규칙(칸 순서, 품질 규칙, 진행 순서)을 받습니다. 만들기 전에 꼭 부르고 그대로 따르세요. kind : cards = 플래시카드와 그림 카드 등 과목 데이터, past = 기출문제, pred = 예상문제 (이 과목 기출 예시가 함께 옴).',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['subject_id', 'range_id', 'kind'],
      properties: { subject_id: { type: 'string' }, range_id: { type: 'string' }, kind: { type: 'string', enum: ['cards', 'past', 'pred'] } },
    },
  },
  {
    name: 'list_files',
    description: '과목 자료 탭에 올라간 PDF 파일 이름 목록입니다. 그림 카드의 file 칸은 여기 이름과 똑같이 적으세요.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['subject_id'], properties: { subject_id: { type: 'string' }, range_id: { type: 'string' } } },
  },
  {
    name: 'prepare_upload',
    description: 'PDF 자료(써머리, 기출 원본, 기타 자료)를 앱 자료 탭에 올리는 링크를 만듭니다. 파일은 Claude 가 올릴 수 없고, 사용자가 링크를 눌러 앱에서 파일만 고르면 됩니다. 부르기 전에 사용자에게 과목, 범위, 종류, 이름(기출이면 학번과 중간/기말), 올리는 방식(한 파일 계속 바꾸기 / 주차별로 쌓기), 주차를 확인하세요. list_files 로 이미 있는 이름을 보고 같은 묶음이면 이름을 글자까지 똑같이 쓰세요.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['subject_id', 'range_id', 'category'],
      properties: {
        subject_id: { type: 'string' }, range_id: { type: 'string' },
        category: { type: 'string', enum: ['summary', 'past', 'etc'], description: 'summary = 써머리, past = 기출 원본, etc = 기타 자료' },
        series: { type: 'string', description: '자료 이름 (예: 본초학 써머리). 기출이면 비움' },
        mode: { type: 'string', enum: ['single', 'weekly'], description: 'single = 한 파일 계속 바꾸기, weekly = 주차별로 쌓기. 기출은 single' },
        week: { type: 'string', description: 'weekly 일 때 주차 (예: 3주차)' },
        exam_no: { type: 'string', description: '기출일 때 학번 두 자리 (예: 25)' },
        exam_term: { type: 'string', enum: ['중간', '기말'], description: '기출일 때 시험' },
      },
    },
  },
  {
    name: 'submit_draft',
    description: '만든 데이터를 앱의 "검토 대기"로 보냅니다. 바로 반영되지 않고, 사용자가 앱에서 확인한 뒤 넣습니다. sheets 는 { 탭 키: 행 배열 }, 각 행은 get_instructions 의 칸 순서 그대로인 문자열 배열 (머리줄 없음). 탭 키는 list_subjects 의 kinds 에 있는 것만. past, pred 는 다른 탭과 섞지 말고 따로 보내세요. 행이 많으면 묶음별로 나눠 여러 번 보내도 됩니다.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['subject_id', 'range_id', 'title', 'sheets'],
      properties: {
        subject_id: { type: 'string' }, range_id: { type: 'string' },
        title: { type: 'string', description: '검토 목록에 보일 짧은 이름. 예: 5주차 소화기 카드' },
        note: { type: 'string', description: '검수 목록 (확인이 필요한 것, 빠진 것). 없으면 비움' },
        sheets: { type: 'object', additionalProperties: { type: 'array', items: { type: 'array', items: { type: 'string' } } } },
      },
    },
  },
];

const INSTRUCTIONS = [
  '공부하니(원광한의대 학습 앱)에 넣을 데이터를 만드는 연결입니다.',
  '순서 : list_subjects 로 과목과 범위 확인 → get_instructions 로 규칙 받기 → 규칙의 진행 순서대로 사용자와 정하기 → submit_draft 로 검토 대기에 보내기.',
  '엑셀 파일은 만들 필요 없습니다. 보낸 뒤에는 앱의 과목 화면에서 "검토 대기"를 눌러 확인하고 넣으면 된다고 안내하세요.',
  'PDF 파일을 자료 탭에 올려 달라고 하면 : 과목, 범위, 종류, 이름, 방식, 주차를 물어 정한 뒤 prepare_upload 로 링크를 만들어 주세요. 파일 자체는 Claude 가 올릴 수 없습니다.',
].join('\n');

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET' || req.method === 'DELETE') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  if (req.method !== 'POST') return new Response('ok');

  const env = (k: string) => Deno.env.get(k) || '';
  const svc = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });

  // ── 열쇠 확인 ──
  const key = (url.searchParams.get('key') || (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')).trim();
  if (!/^kmed_[A-Za-z0-9_-]{30,}$/.test(key)) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: '연결 열쇠가 없거나 잘못되었습니다. 앱 설정의 Claude 연결에서 주소를 다시 복사하세요.' } }, 401);
  const { data: tok } = await svc.from('claude_tokens').select('id,user_id,last_used').eq('hash', await sha256(key)).maybeSingle();
  if (!tok) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: '끊긴 연결 열쇠입니다. 앱 설정의 Claude 연결에서 새로 만드세요.' } }, 401);
  const { data: me } = await svc.from('profiles').select('id,role,name').eq('id', tok.user_id).maybeSingle();
  if (!me || !['writer', 'admin'].includes(me.role)) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: '과목 담당만 쓸 수 있습니다.' } }, 403);
  if (!tok.last_used || Date.now() - Date.parse(tok.last_used) > 60_000) svc.from('claude_tokens').update({ last_used: new Date().toISOString() }).eq('id', tok.id).then(() => {});

  // 내가 쓸 수 있는 과목
  const mySubjects = async () => {
    if (me.role === 'admin') return ((await svc.from('subjects').select('id').order('grade').order('sort')).data || []).map((s) => s.id);
    return ((await svc.from('subject_writers').select('subject_id').eq('user_id', me.id)).data || []).map((s) => s.subject_id);
  };
  const subjectOf = async (sid: string, rid?: string) => {
    if (!(await mySubjects()).includes(sid)) throw new Error('담당하지 않는 과목입니다. list_subjects 의 subject_id 를 쓰세요.');
    const { data: sub } = await svc.from('subjects').select('id,name,grade').eq('id', sid).maybeSingle();
    if (!sub) throw new Error('과목을 찾을 수 없습니다.');
    let range = null;
    if (rid) {
      range = (await svc.from('ranges').select('id,name').eq('id', rid).eq('subject_id', sid).maybeSingle()).data;
      if (!range) throw new Error('이 과목의 범위가 아닙니다. list_subjects 의 range_id 를 쓰세요.');
    }
    const kinds = ((await svc.from('blocks').select('kind').eq('subject_id', sid)).data || []).map((b) => b.kind);
    const f = await formats();
    return { sub, range, keys: [...f.formatsFor(kinds), 'past', 'pred'], f };
  };

  // ── 도구 ──
  async function call(name: string, a: Record<string, unknown>): Promise<string> {
    if (name === 'list_subjects') {
      const ids = await mySubjects();
      if (!ids.length) return '담당 과목이 없습니다.';
      const f = await formats();
      const [{ data: subs }, { data: rs }, { data: bl }] = await Promise.all([
        svc.from('subjects').select('id,name,grade,semester,sort').in('id', ids),
        svc.from('ranges').select('id,subject_id,name,sort').in('subject_id', ids).order('sort'),
        svc.from('blocks').select('subject_id,kind').in('subject_id', ids),
      ]);
      const out = (subs || []).sort((x, y) => x.grade - y.grade || x.semester - y.semester || x.sort - y.sort).map((s) => {
        const keys = [...f.formatsFor((bl || []).filter((b) => b.subject_id === s.id).map((b) => b.kind)), 'past', 'pred'];
        return {
          subject_id: s.id, name: s.name, grade: `${s.grade}학년 ${s.semester}학기`,
          ranges: (rs || []).filter((r) => r.subject_id === s.id).map((r) => ({ range_id: r.id, name: r.name })),
          kinds: keys.map((k) => ({ key: k, tab: f.FORMATS[k]?.sheet, label: f.FORMATS[k]?.label })),
        };
      });
      return JSON.stringify(out, null, 1);
    }

    if (name === 'get_instructions') {
      const { sub, range, keys, f } = await subjectOf(String(a.subject_id), String(a.range_id));
      const o = { subject: sub.name, range: range!.name };
      let text: string; let send: string[];
      if (a.kind === 'past') { text = f.buildPastRequest(o); send = ['past']; }
      else if (a.kind === 'pred') {
        const { data: rs } = await svc.from('ranges').select('id').eq('subject_id', sub.id);
        const ids = (rs || []).map((r) => r.id);
        const past = ids.length ? ((await svc.from('past_questions').select('type,question,choices,answer').in('range_id', ids).eq('kind', 'past').order('sort').limit(500)).data || []) : [];
        text = f.buildPredRequest({ ...o, past }); send = ['pred'];
      } else {
        send = keys.filter((k) => k !== 'past' && k !== 'pred');
        if (!send.length) return '이 과목은 카드 데이터 형식이 없습니다. past 또는 pred 를 쓰세요.';
        text = f.buildRequest(send, o);
      }
      const map = send.map((k) => `"${k}" = ${f.FORMATS[k].sheet} 탭 (${f.FORMATS[k].cols.length}칸)`).join(', ');
      return `${text}

────────
[공부하니 연결로 보내기] 위 글은 엑셀로 받을 때 쓰던 안내입니다. 이번에는 이렇게 하세요.
- 엑셀 파일은 만들지 않습니다. 위 규칙(칸 순서, 품질, 진행 순서)은 그대로 따르고, 다 만들면 submit_draft 로 보냅니다.
- subject_id "${sub.id}", range_id "${range!.id}"
- sheets 의 키 : ${map}
- 각 행은 칸 순서 그대로인 문자열 배열. 머리줄 없음, 빈 칸은 "".
- 보내기 전에 묶음(또는 자료)별 개수를 사용자에게 보여 주고 확인받으세요.
- 행이 많으면 (1500행 넘음) 묶음별로 나눠 여러 번 보내도 됩니다. 한 번 보낼 때마다 검토 대기 1건이 됩니다.
- 그림 탭이 있으면 file 칸은 list_files 의 이름과 똑같이 적으세요.
- 보낸 뒤 사용자에게 "앱의 ${sub.name} 화면 위 검토 대기에서 확인하고 넣으세요" 라고 알려 주세요.`;
    }

    if (name === 'list_files') {
      await subjectOf(String(a.subject_id));
      let q = svc.from('files').select('filename,range_id,category,series,mode,week,created_at').eq('subject_id', String(a.subject_id)).order('created_at');
      if (a.range_id) q = q.eq('range_id', String(a.range_id));
      const { data } = await q;
      if (!(data || []).length) return '올라간 PDF 가 없습니다. 사용자가 채팅에 올린 파일 이름을 쓰세요.';
      const CAT = { summary: '써머리', past: '기출', etc: '기타 자료' };
      const groups = new Map();
      for (const x of data || []) {
        const k = `${x.category}|${x.series}`;
        if (!groups.has(k)) groups.set(k, { cat: CAT[x.category] || '써머리', series: x.series, mode: x.mode, weeks: new Set(), files: [] });
        const g = groups.get(k); if (x.week) g.weeks.add(x.week); g.files.push(x.filename);
      }
      return [...groups.values()].map((g) => `[${g.cat}] ${g.series} (${g.mode === 'weekly' ? `주차별 : ${[...g.weeks].join(', ')}` : '한 파일'})\n${g.files.map((f) => `  - ${f}`).join('\n')}`).join('\n');
    }

    if (name === 'prepare_upload') {
      const { sub, range } = await subjectOf(String(a.subject_id), String(a.range_id));
      const { data: bl } = await svc.from('blocks').select('kind').eq('subject_id', sub.id).eq('kind', 'summary');
      if (!(bl || []).length) throw new Error('이 과목에는 자료 탭이 없습니다. 관리 화면에서 자료 탭을 먼저 추가해야 합니다.');
      const cat = String(a.category);
      const p = new URLSearchParams({ r: range!.id, b: 'summary', up: '1', cat });
      let what: string;
      if (cat === 'past') {
        const no = String(a.exam_no || '').trim();
        if (!/^\d{2}$/.test(no)) throw new Error('기출은 학번 두 자리(exam_no)가 필요합니다. 사용자에게 몇 학번 시험인지 물어보세요.');
        const term = a.exam_term === '중간' ? '중간' : '기말';
        p.set('no', no); p.set('term', term); p.set('mode', 'single');
        what = `기출 ${no}학번 ${term}`;
      } else {
        const series = String(a.series || '').trim();
        if (!series) throw new Error('자료 이름(series)이 필요합니다. 예: 본초학 써머리');
        const mode = a.mode === 'weekly' ? 'weekly' : 'single';
        p.set('ser', series); p.set('mode', mode);
        if (mode === 'weekly') { const wk = String(a.week || '').trim(); if (!wk) throw new Error('주차별로 쌓기면 주차(week)가 필요합니다. 예: 3주차'); p.set('wk', wk); }
        what = `${cat === 'etc' ? '기타 자료' : '써머리'} "${series}"${mode === 'weekly' ? ` ${p.get('wk')}` : ''}`;
      }
      const link = `${APP_URL}/#/s/${sub.id}?${p.toString()}`;
      return `올리기 링크를 만들었습니다. 사용자에게 아래 링크를 그대로 보여 주세요.

${link}

안내 : 링크를 누르면 공부하니 ${sub.name} ${range!.name} 자료 탭에서 올리기 창이 ${what} 로 채워져 열립니다. PDF 파일만 고르고 업로드를 누르면 됩니다. (앱에 로그인되어 있어야 하고, 이미 같은 이름의 자료가 있으면 그 묶음에 이어서 올라갑니다)`;
    }

    if (name === 'submit_draft') {
      const { sub, range, keys, f } = await subjectOf(String(a.subject_id), String(a.range_id));
      const sheets = (a.sheets || {}) as Record<string, unknown>;
      const use = Object.keys(sheets).filter((k) => Array.isArray(sheets[k]) && (sheets[k] as unknown[]).length);
      if (!use.length) throw new Error('보낼 행이 없습니다.');
      const bad = use.filter((k) => !keys.includes(k));
      if (bad.length) throw new Error(`이 과목에 없는 탭입니다 : ${bad.join(', ')}. 쓸 수 있는 키 : ${keys.join(', ')}`);
      if (use.length > 1 && use.some((k) => k === 'past' || k === 'pred')) throw new Error('past, pred 는 다른 탭과 따로 보내세요.');
      const payload: Record<string, string> = {}; const rows: Record<string, number> = {}; let total = 0;
      for (const k of use) {
        const raw = sheets[k] as unknown[];
        const n = f.FORMATS[k].cols.length;
        const clean = raw.map((r, i) => {
          if (!Array.isArray(r)) throw new Error(`${k} ${i + 1}번째 행이 배열이 아닙니다.`);
          if (r.length > n + 2) throw new Error(`${k} ${i + 1}번째 행이 ${r.length}칸입니다. ${f.FORMATS[k].sheet} 탭은 ${n}칸입니다.`);
          return r.map((c) => (c == null ? '' : String(c)));
        }).filter((r) => r.some((c) => c.trim()));
        payload[k] = toTSV(clean); rows[k] = clean.length; total += clean.length;
      }
      if (total > LIMIT.rows) throw new Error(`한 번에 ${LIMIT.rows}행까지 보낼 수 있습니다. 묶음별로 나눠 보내세요.`);
      if (new TextEncoder().encode(JSON.stringify(payload)).length > LIMIT.bytes) throw new Error('내용이 너무 큽니다. 묶음별로 나눠 보내세요.');
      const { count } = await svc.from('import_drafts').select('id', { count: 'exact', head: true }).eq('subject_id', sub.id).eq('status', 'pending');
      if ((count || 0) >= LIMIT.pending) throw new Error(`검토 대기가 ${LIMIT.pending}건 쌓여 있습니다. 앱에서 먼저 정리해 주세요.`);
      const { error } = await svc.from('import_drafts').insert({
        subject_id: sub.id, range_id: range!.id, keys: use, payload, rows,
        title: String(a.title || '').slice(0, 80), note: String(a.note || '').slice(0, 4000), created_by: me.id,
      });
      if (error) throw new Error('저장하지 못했습니다 : ' + error.message);
      const sum = use.map((k) => `${f.FORMATS[k].sheet} ${rows[k]}행`).join(', ');
      return `검토 대기에 올렸습니다 (${sub.name} ${range!.name} : ${sum}). 앱의 ${sub.name} 화면 위 "검토 대기"에서 확인하고 넣으면 반영됩니다.`;
    }
    throw new Error('없는 도구입니다.');
  }

  // ── JSON-RPC (MCP Streamable HTTP, 응답은 JSON 한 번) ──
  async function handle(m: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }) {
    const id = m.id;
    if (id === undefined || id === null) return null; // 알림 (notifications/initialized 등)
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    switch (m.method) {
      case 'initialize': {
        const want = String(m.params?.protocolVersion || '');
        const ver = ['2025-06-18', '2025-03-26', '2024-11-05'].includes(want) ? want : '2025-03-26';
        return ok({ protocolVersion: ver, capabilities: { tools: { listChanged: false } }, serverInfo: { name: '공부하니', version: VERSION }, instructions: INSTRUCTIONS });
      }
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: TOOLS });
      case 'tools/call': {
        const p = (m.params || {}) as { name?: string; arguments?: Record<string, unknown> };
        try { return ok({ content: [{ type: 'text', text: await call(String(p.name), p.arguments || {}) }] }); }
        catch (e) { return ok({ content: [{ type: 'text', text: (e as Error).message || '오류가 났습니다.' }], isError: true }); }
      }
      case 'resources/list': return ok({ resources: [] });
      case 'prompts/list': return ok({ prompts: [] });
      default: return { jsonrpc: '2.0', id, error: { code: -32601, message: `지원하지 않는 메서드 : ${m.method}` } };
    }
  }

  let body: unknown;
  try { body = await req.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 이 아닙니다.' } }, 400); }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const out = await handle(body as never);
  return out ? json(out) : new Response(null, { status: 202 });
});

// ── 아래는 js/data/formats.js 사본 (실시간 불러오기가 안 될 때 씀) ──
// 고치지 말 것 : scripts/build-claude-mcp.py 가 formats.js 에서 다시 만듦
// FORMATS-START
function bundledFormats() {
// ─────────────────────────────────────────────
// 데이터 형식 : 탭 종류마다 앱이 받는 표 모양 (고정)
//  - 자료 모양(써머리 PDF 구조)은 매번 달라도, 이 표 모양만 맞추면 앱에 들어감
//  - 프롬프트의 '결과물' 부분은 여기서 자동으로 만들어짐
// ─────────────────────────────────────────────
const FORMATS = {
  units: {
    sheet: '단원', label: '단원',
    cols: [['id', '단원 id'], ['label', '단원 이름'], ['order', '등장 순서']],
    rules: [
      'id 는 한글 단원명을 국어의 로마자 표기법으로 바꾼 것. 줄이지 말고 단원명 전체를, 소문자로 공백·기호 없이 이어 붙임. (예: 긍정부사 → geungjeongbusa)',
      '중간점(·)이나 슬래시로 묶인 복합 단원명은 로마자도 이어 붙임.',
      '"OO 예문 N" 의 "예문 N"·숫자는 단원 안 번호일 뿐, 단원은 "OO" 하나로 봄.',
      '두 자료에 나온 모든 단원을 중복 없이, 처음 나온 순서대로 order 1, 2, 3…',
      '결과 맨 위에 "이번 단원 id: 단원명=id" 를 한 줄씩 적어 줄 것. (검수용)',
    ],
  },
  hanja: {
    sheet: '한자', label: '한자',
    cols: [['hanja', '한자 한 글자'], ['hun-eum', '훈음'], ['hint', '암기법 (없으면 비움)']],
    rules: [
      '자료에 나온 한자를 모두 모으되 같은 한자는 한 번만, 등장 순서대로.',
      '훈음은 "훈 음" 형태. (예: 스스로 자) 훈이 여러 개면 " / " 로 구분.',
      '자료에 훈음이 적혀 있으면 그대로. 주석 풀이가 "훈 음" 형태면 그것을 쓰고 부가 설명은 뺌.',
      '훈음을 자료에서 못 찾은 한자만 가장 대표적인 훈으로 채우고, 그런 한자는 결과 맨 위에 목록으로 따로 알려 줄 것.',
    ],
  },
  hanja_unit: {
    sheet: '한자', label: '한자 (단원별)',
    cols: [['unit', '단원 id'], ['hanja', '한자 한 글자'], ['hun-eum', '훈음'], ['hint', '암기법 (없으면 비움)']],
    rules: [
      'unit 은 그 한자가 속한 단원의 id. 단원 탭의 id 와 글자까지 똑같이.',
      '한자 한 글자와 그 한자의 훈음을 짝지어 한 행씩. 빈 칸 · 날짜 · 이름 같은 메타는 건너뜀.',
      '같은 블록이 통째로 중복돼 있으면 한 번만.',
      '문장에 없는 한자가 있어도 정상. 자료에 있는 한자는 모두 뽑을 것.',
    ],
  },
  jung: {
    sheet: '해석', label: '해석',
    cols: [['page', '문장 묶음 번호'], ['hanja', '원문'], ['eum', '음'], ['translation', '해석'],
      ...Array.from({ length: 10 }, (_, i) => [`note${i + 1}`, `주석 ${i + 1}`]), ['hint', '암기법 (묶음 첫 행에만, 없으면 비움)']],
    rules: [
      'page 는 문장 묶음 번호 (1, 2, 3…). 같은 묶음의 행은 page 를 반드시 똑같이.',
      '한 묶음이 여러 원문 조각이면 조각마다 한 행. 해석은 대표 행에 넣고 나머지는 비워도 됨.',
      'note1~note10 은 그 묶음의 주석을 한 칸에 하나씩, 부가 설명까지 그대로. 없으면 비움.',
      '"→" 로 시작하는 핵심 요약이 있으면 주석 다음 칸에 "→ …" 그대로.',
    ],
  },
  um: {
    sheet: '문장', label: '문장',
    cols: [['unit', '단원 id'], ['sentence', '원문'], ['cards', '카드'], ['order', '순서'], ['translation', '해석'], ['source', '출처'], ['hint', '암기법 (없으면 비움)']],
    rules: [
      '한 머리 아래 문장이 여러 개면 합치지 말고 문장 수만큼 행을 나눔. (unit 은 같게)',
      'cards : 카드에 해당하는 한자 토큰. 弟子 처럼 2자 이상도 한 토큰. 칸 안에서는 반드시 " / " 로 구분.',
      'order : 순서 숫자. 반드시 " / " 로 구분. 카드 하나에 숫자 하나 (글자 수가 아니라 카드 수만큼).',
      'cards 개수 = order 개수. order 는 문장마다 1부터 빠짐없이.',
      '출처가 없으면 source 는 비움.',
      '숫자·글자가 깨지거나 cards 와 order 개수가 안 맞으면 억지로 맞추지 말고 그 행을 검수용으로 표시.',
    ],
  },
  flash: {
    sheet: '카드', label: '플래시카드',
    cols: [['deck', '묶음 (단원)'], ['front', '앞면'], ['back', '뒷면'], ['hint', '암기법 (없으면 비움)']],
    rules: [
      '카드 한 장이 한 행. 앞면은 묻는 것, 뒷면은 답.',
      '[과목 성격] 먼저 자료가 어떤 쪽인지 봄.',
      '  - 단어 암기형 (단어 목록 위주 : 의학용어, 어근과 접미사, 약재 이름 등) : 자료에 나온 단어 하나가 카드 한 장. 앞면 단어, 뒷면 뜻. 설명을 묻는 카드, "~은 무엇인가" 같은 문제형 카드, 흐름이나 원리를 묻는 카드는 만들지 않음. 자료의 단어 표나 목록에 없는 단어를 새로 뽑아내지 않음.',
      '  - 개념형 (설명, 분류, 비교 위주) : 아래 [무엇을 카드로] 기준으로 외울 것만 골라 만듦.',
      '[무엇을 카드로] 자료를 통째로 옮기지 말고 시험에 나오고 외워야 하는 것만.',
      '  - 만들 것 : 용어와 정의, 약재나 처방의 효능과 주치, 분류(무엇에 속하는지), 짝이 되는 것(원인-증상, 장부-기능), 숫자와 용량과 순서, 비슷한 것끼리의 차이, 자료에서 강조(굵은 글씨, 별표, 밑줄, 시험 표시)된 것.',
      '  - 뺄 것 : 흐름을 잇는 설명 문장, 예시와 잡담, 이미 다른 카드에 있는 내용.',
      '  - 한 카드에는 한 가지만 물음. 답이 길면 여러 장으로 나눔. (예: 마황 효능은 한 장, 마황 주치는 다른 한 장)',
      '  - 그림을 보고 이름이나 위치를 외워야 하는 것(해부 그림, 경혈 위치, 약재 사진 등)은 이 탭이 아니라 그림 탭에.',
      '[앞면과 뒷면]',
      '  - 앞면은 무엇을 묻는지 바로 알게. (예: "마황 효능", "발산풍한약에 속하는 약재")',
      '  - 용어 카드의 앞면은 자료에 나온 용어만. 영어 자료면 영어 그대로. "정의", "뜻" 같은 꼬리말이나 괄호로 다른 언어를 덧붙이지 않음.',
      '  - 뒷면은 자료 표현 그대로. 한글과 원문 설명이 둘 다 있으면 한글을 먼저, 다음 줄에 원문 설명. 여러 개면 줄바꿈.',
      '  - 자료에 오타나 깨진 글자가 있으면 고쳐 넣지 말고 그 카드는 빼고 검수 목록에 알림.',
      '[묶음 (deck)]',
      '  - 자료가 주차나 챕터(강의 회차)로 나뉘면 "주차 > 소단원" 처럼 " > " 로 이어 씀. (예: "5주차 > Combining Forms", "Chapter 5 > Suffixes") 앱에서 주차별로 접어서 보여 줌.',
      '  - 소단원은 자료 안의 작은 제목(Vocabulary, Combining Forms, Suffixes, Pathology 등)을 그대로. "소화기 전반" 처럼 뭉뚱그린 묶음을 새로 만들지 않음.',
      '  - 주차 구분이 없으면 한 단계만 : 자료의 장, 절 제목 → 없으면 파일 하나가 묶음 하나 → 그것도 없으면 내용 주제로 10~40장씩.',
      '  - 같은 묶음은 글자까지 똑같이 (주차 이름도 모든 행에서 똑같이), 순서는 자료 순서대로. 같은 소단원 이름이 여러 주차에 나오면 주차가 앞에 붙으니 그대로 둬도 됨.',
      '  - 40장이 넘는 묶음은 쪼개지 말고 검수 목록에 알림.',
      '[파일이 여러 개일 때] 전부 읽고 하나의 표로 합침. 같은 내용이 여러 파일에 있으면 자료 순서상 먼저 나온 한 장만.',
      '결과 맨 위에 묶음 이름과 장 수 목록을 적어 줄 것. (검수용)',
    ],
  },
  occ: {
    sheet: '그림', label: '그림 카드',
    cols: [['deck', '묶음 (단원)'], ['type', '형식'], ['title', '그림 이름'], ['file', '파일 이름'], ['page', 'PDF 몇 번째 장'], ['names', '이름들'], ['hint', '암기법 (없으면 비움)']],
    rules: [
      '그림을 보고 이름이나 위치를 외워야 하는 것을 그림 한 장에 한 행으로. 앱에서 그림을 오리고 이름 자리에 테이프를 붙이면 이름 하나가 카드 한 장이 됨.',
      '[그림 카드로 만들 것] 이름표(지시선)가 붙은 해부 그림, 조직이나 구조 그림, 경혈이나 부위 위치 그림, 약재나 표본 사진처럼 그림 자체를 알아봐야 하는 것. 원본에 "그림을 보고 이름을 쓰시오" 같은 문제가 있으면 그 그림도 넣음.',
      '[만들지 말 것] 꾸밈 그림, 글로만 외워도 되는 표나 순서도, 이름표가 하나도 없는 그림(그림 전체 형식이 아니면).',
      'type : "가리기" 또는 "그림 전체". 가리기는 그림 안 이름표 여러 개를 하나씩 가려서 묻는 것. 그림 전체는 그림(사진) 한 장을 보고 그것이 무엇인지 맞히는 것.',
      'title : 그림을 알아볼 수 있는 짧은 이름 (예: "팔 앞면 근육", "족양명위경 하지"). 자료에 그림 제목이 있으면 그대로.',
      '[그림 읽는 법] PDF 에서 글자만 뽑으면 그림 속 이름표는 안 나옴. 그림이 있는 장은 반드시 이미지로 열어서 직접 보고, 작은 글씨는 그 부분을 크게 확대해서 읽을 것.',
      'file : 그 그림이 있는 첨부 파일의 이름. 올릴 때 이름 앞에 붙은 무작위 글자(영문 숫자 묶음)는 빼고 원래 이름만. 이름이 깨져 보이면 그대로 적고 검수 목록에 알림.',
      'page : 그 파일에서 몇 번째 장인지 (첫 장 = 1). 슬라이드나 인쇄된 쪽 번호가 아니라 PDF 의 실제 순서. 둘은 보통 몇 장씩 어긋나니 꼭 PDF 순서로 셀 것. 앱이 이 장을 바로 열어 줌.',
      'names : 가리기는 그림 안 이름표 글자를 그대로, " | " 로 구분. 순서는 위에서 아래, 같은 높이면 왼쪽에서 오른쪽. 그림 옆에 한글 뜻이 같이 적혀 있으면 "Gums(잇몸)" 처럼 그대로. 그림 전체는 정답 이름 하나만.',
      '- 같은 이름표가 한 그림에 두 번 이상 있으면(좌우 등) names 에는 한 번만 적고 검수 목록에 알림. (앱에서 두 자리에 같은 이름을 붙일 수 있음)',
      '- 그림 전체 형식에서 한 장에 사진이 여러 장이면 사진마다 한 행 (page 는 같게, title 은 사진마다 다르게).',
      '- 순서도나 표처럼 글로 외워도 되는 것은 그림 카드로 만들지 말고 카드 탭에 넣음.',
      '- 그림 안에 숫자만 있고 이름은 아래 범례(1. 상완이두근 …)에 있으면 범례의 이름을 숫자 순서대로 적고, 결과 맨 위 검수 목록에 "범례형 : 그림 이름" 이라고 알려 줌. (앱에서 숫자 자리에 테이프를 붙임)',
      '- 그림 속 글자가 작거나 흐려서 확실하지 않은 이름은 끝에 ? 를 붙임 (예: 상완근?). 지어내지 말 것.',
      '- 한 그림에 이름표가 25개를 넘으면 부위별로 나눠 여러 행으로 (title 에 "위", "아래" 처럼 구분).',
      'deck : 카드 탭의 deck 과 같은 기준, 글자까지 똑같이 (예: "Chapter 5 > Vocabulary"). 그래야 앱에서 같은 묶음으로 같이 보임.',
      '결과 맨 위에 그림 목록(그림 이름, 파일, 장, 이름 수)을 적어 줄 것. (검수용)',
    ],
  },
  past: {
    sheet: '기출', label: '기출문제',
    cols: [['exam', '시험 이름'], ['no', '문항 번호'], ['type', '문제 형식'], ['passage', '지문'], ['question', '문제'],
      ['choices', '보기'], ['answer', '정답'], ['explain', '해설'], ['source', '정답 근거'], ['tag', '단원'], ['accept', '인정 답안']],
    rules: [
      '문제 하나가 한 행. 원본에 나온 모든 문제를 빠짐없이, 원본 순서대로.',
      'exam : 학번과 시험을 "25학번 기말" 처럼. 원본 표지나 파일 이름에서 찾고, 없으면 내가 알려 준 이름을 씀.',
      'no : 원본의 문항 번호 그대로. 한 문제 안의 소문항은 "3-1", "3-2" 처럼 나눠서 각각 한 행.',
      'type : 객관식, OX, 빈칸, 단답, 서술 중 하나. 원본 모양을 보고 네가 판단. 빈칸 채우기는 빈칸, 한두 단어 답은 단답, 문장으로 쓰는 답은 서술.',
      'passage : 여러 문제가 같이 보는 지문이나 표, 사례가 있으면 그 문제들 행마다 똑같이 넣음. 없으면 비움.',
      'question : 문제 문장 그대로. 빈칸은 ( ) 로 표시. 그림이나 표는 글로 옮길 수 있는 만큼 옮기고, 안 되면 [그림: 무엇에 대한 그림] 처럼 적음.',
      'choices : 객관식 보기만, " | " 로 구분. 번호(①, 1.)는 빼고 내용만. 객관식이 아니면 비움.',
      'answer : 객관식은 정답 번호 숫자(여러 개면 "2, 4"), OX 는 O 또는 X, 나머지는 정답 글. 서술형은 채점 기준이 되는 핵심 내용을 2~4문장으로.',
      'explain : 왜 그게 정답인지 짧은 해설. 써머리에서 근거가 된 부분(단원, 쪽)이 있으면 함께 적음.',
      'source : 원본에 정답이 적혀 있으면 "기출", 원본에 정답이 없어서 써머리를 보고 네가 정한 정답이면 "AI".',
      'tag : 이 문제가 써머리의 어느 단원(또는 주차)에서 나왔는지. 써머리에 적힌 단원 이름 그대로 짧게 (예: "3주차 발산풍한약"). 같은 단원은 글자까지 똑같이. 못 찾으면 비움.',
      'accept : 빈칸, 단답만. 정답과 같은 뜻으로 인정할 다른 표현(한자 표기, 띄어쓰기 다른 것, 줄임말, 동의어)을 " | " 로 구분. 없으면 비움. 객관식, OX, 서술은 비움.',
    ],
  },
  pred: {
    sheet: '예상문제', label: '예상문제',
    cols: [['exam', '자료 이름'], ['no', '문항 번호'], ['type', '문제 형식'], ['passage', '지문'], ['question', '문제'],
      ['choices', '보기'], ['answer', '정답'], ['explain', '해설'], ['source', '근거 위치'], ['tag', '단원'], ['accept', '인정 답안']],
    rules: [
      '문제 하나가 한 행.',
      'exam : 문제를 만든 자료(첨부 파일) 하나의 이름을 짧게 (예: "5주차 소화기계"). 앱에서 이 이름별로 문제 묶음이 됨. 같은 자료는 글자까지 똑같이.',
      'no : 자료마다 1부터.',
      'type : 객관식, OX, 빈칸, 단답 중 하나. 서술형은 만들지 않음.',
      'passage : 여러 문제가 같이 보는 표나 사례가 있으면 그 문제들 행마다 똑같이. 없으면 비움.',
      'question : 문제 문장. 빈칸은 ( ). "옳지 않은 것" 처럼 부정형이면 그 부분을 [옳지 않은] 처럼 대괄호로 감쌈.',
      'choices : 객관식 보기를 " | " 로 구분 (번호 빼고 내용만). 개수는 기출이나 2단계에서 정한 대로, 정한 게 없으면 5개. 객관식이 아니면 비움.',
      'answer : 객관식은 정답 번호 숫자, OX 는 O 또는 X, 빈칸과 단답은 정답 글.',
      'explain : 정답인 이유 한두 문장 + 객관식은 오답 보기마다 왜 틀렸는지 한 줄씩 ("② 는 ~ 라서 틀림").',
      'source : 근거가 된 자료 위치 (파일 이름과 PDF 몇 번째 장, 예: "5주차 소화기계 12장"). 자료 밖 지식이면 "자료 밖".',
      'tag : 자료 안의 단원(작은 제목) 이름 그대로 짧게. 같은 단원은 글자까지 똑같이. 주차나 챕터가 있으면 "5주차 > Combining Forms" 처럼 " > " 로 이어 씀. 앱에서 이 단원별로 골라서 풂.',
      'accept : 빈칸, 단답만. 같은 답으로 인정할 다른 표현(한글과 영문, 한자, 줄임말, 동의어, 띄어쓰기 다른 것)을 " | " 로. 없으면 비움.',
    ],
  },
};

// 과목의 탭 구성 → 받아야 할 표
function formatsFor(kinds) {
  const k = new Set(kinds);
  if (k.has('um_order') || k.has('um_answers')) return ['units', 'hanja_unit', 'um'];
  const out = [];
  if (k.has('hanja_r') || k.has('hanja_h') || k.has('hanja_grid') || k.has('wordbook')) out.push('hanja');
  if (k.has('jung_translate')) out.push('jung');
  if (k.has('flash')) out.push('flash', 'occ');
  return out;
}

// 기출문제 부탁 글 : 형식이 제각각이라 AI 가 직접 판단하게
function buildPastRequest({ subject, range }) {
  const f = FORMATS.past;
  const L = [];
  L.push(`학습 앱의 기출문제 은행에 넣을 엑셀(.xlsx)을 만들어 줘. 과목은 ${subject}, 범위는 ${range}이야.`);
  L.push('첨부 파일 중 기출 원본 PDF 는 풀어야 할 문제이고, 써머리(수업 자료)는 정답과 해설의 근거야.', '');
  L.push('[해야 할 일]');
  L.push('1. 기출 원본을 처음부터 끝까지 읽고 문제를 하나씩 나눠.');
  L.push('2. 기출마다 모양이 다 달라. 문제 형식(객관식, OX, 빈칸, 단답, 서술), 지문이 묶인 문제, 소문항 같은 구조는 네가 원본을 보고 판단해.');
  L.push('3. 원본에 정답이 있으면 그대로 쓰고, 없으면 써머리를 근거로 정답과 해설을 만들어. 써머리에 근거가 없으면 네 지식으로 정하되 해설에 "써머리에 근거 없음" 이라고 적어.');
  L.push('4. 정답이 애매하거나 원본 글자가 깨져서 확신이 없는 문제는 결과 맨 위 검수 목록에 번호와 이유를 적어.', '');
  L.push('[결과물] 시트 1개("기출")가 든 .xlsx 하나', '- 헤더(첫 줄)는 넣지 말고 1행부터 데이터', '- 칸(열) 순서는 아래 그대로', '');
  L.push(`[기출 탭] ${f.cols.length}칸 : ${f.cols.map(([c, d], i) => `(${i + 1})${c} ${d}`).join(', ')}`);
  f.rules.forEach((r) => L.push(`- ${r}`));
  L.push('', '[주의]', '- 문제 문장, 보기는 원본 그대로 옮기고 다듬거나 요약하지 말 것', '- 원본이 여러 개면 시험마다 exam 을 다르게', '', '다 만들면 .xlsx 파일로 받게 해 줘.');
  return L.join('\n');
}

// Claude 에게 보낼 부탁 글 (자료 모양은 Claude 가 직접 보고 판단, 앱이 받는 표 모양만 정확히 전달)
function buildRequest(keys, { subject, range }) {
  const L = [];
  L.push(`학습 앱에 넣을 엑셀(.xlsx)을 만들어 줘. 과목은 ${subject}, 범위는 ${range}이야.`);
  L.push('첨부한 자료를 직접 보고 구조를 파악해서, 아래 형식에 정확히 맞춰 줘. 파일이 여러 개면 전부 읽고 하나로 합쳐 줘.', '');
  if (keys.includes('flash') || keys.includes('occ')) {
    L.push('[진행 순서] 바로 파일을 만들지 말고 아래 순서대로 나랑 먼저 정하고 만들어 줘.');
    L.push('1단계 정리해서 보여 주기 : 자료를 전부 읽고 인식한 내용을 범주별로 보기 좋게 정리해 줘. 아직 파일은 만들지 말 것.');
    L.push('  - 과목 성격 : 단어 암기형(단어 목록 위주) / 개념형(설명, 원리, 비교 위주) / 섞임 중 어느 쪽으로 보이는지와 근거');
    L.push('  - 파일별 구성 : 주차(챕터), 그 안의 작은 제목, PDF 장 범위');
    L.push('  - 카드로 만들 만한 내용 : 종류별(용어와 뜻, 분류, 짝, 숫자와 순서, 비교, 강조 표시된 것 등)로 대략 몇 장인지와 예시 하나씩');
    if (keys.includes('occ')) L.push('  - 그림 카드 후보 : 그림 이름, 파일, PDF 몇 번째 장, 이름표 수, 가리기 / 그림 전체 중 어느 쪽이 맞는지');
    L.push('  - 애매한 것 : 오타나 깨진 글자, 같은 내용이 여러 곳에 나오는 것, 범례형 그림 등');
    L.push('2단계 질문하기 : 정리 아래에 번호를 붙여 질문하고, 질문마다 네 추천안과 이유를 한 줄로 붙여 줘. 한 번에 7개 이하, 내가 "1 추천대로, 2 B" 처럼 짧게 답할 수 있게 보기를 A, B 로 줘.');
    L.push('  - 과목 성격대로 만들지 (단어 암기형이면 단어 카드만, 문제형 카드 없음)');
    L.push('  - 묶음(deck) 나누는 기준과 추천 묶음 목록 : "주차 > 소단원" 두 단계로 할지, 묶음 이름과 예상 장 수');
    L.push('  - 어디까지 카드로 만들지 (전부 / 강조된 것 위주 / 시험 범위만), 한 장에 얼마나 잘게 쪼갤지');
    L.push('  - 앞면, 뒷면 모양 : 앞면 언어, 뒷면에 무엇을 어떤 순서로. 이 질문에는 추천안대로 만든 예시 카드 2~3장을 같이 보여 줘');
    if (keys.includes('occ')) L.push('  - 그림 카드로 넣을 그림 고르기');
    L.push('  - 1단계에서 찾은 애매한 것을 어떻게 할지');
    L.push('3단계 만들기 : 내 답을 반영해서 만들고, 결과 맨 위에 정한 내용 요약과 검수 목록을 적어 줘. 내가 "추천대로 해" 라고 하면 추천안 전부로 바로 만들어.');
    L.push('');
  }
  L.push(`[결과물] 시트 ${keys.length}개가 든 .xlsx 하나. 탭 이름은 ${keys.map((k) => `"${FORMATS[k].sheet}"`).join(', ')}`);
  L.push('- 헤더(첫 줄)는 넣지 말고 1행부터 데이터', '- 칸(열) 순서는 아래 그대로', '');
  keys.forEach((k) => {
    const f = FORMATS[k];
    L.push(`[${f.sheet} 탭] ${f.cols.length}칸 : ${f.cols.map(([c, d], i) => `(${i + 1})${c} ${d}`).join(', ')}`);
    f.rules.forEach((r) => L.push(r.startsWith('  - ') ? `  ${r.slice(2)}` : r.startsWith('- ') ? `  ${r}` : `- ${r}`));
    if (f.cols.some(([c]) => c === 'hint')) L.push(`- ${'암기법은 그 항목을 외우는 데 쓰는 짧은 메모. 자료에 있으면 그대로, 없으면 비움.'}`);
    L.push('');
  });
  L.push('[공통 규칙]', '- 한자, 훈음, 해석은 지어내지 말고 자료에 있는 그대로', '- 자료 구조가 애매하면 먼저 나에게 물어보고, 깨지거나 헷갈리는 부분은 결과 맨 위에 검수 목록으로 알려 줘', '', '다 만들면 .xlsx 파일로 받게 해 줘.');
  if (keys.includes('flash') || keys.includes('occ')) L.push('위 형식과 규칙은 기본값이야. 2단계에서 내가 다르게 정한 것이 있으면 그쪽을 따라 줘.');
  return L.join('\n');
}

// 예상문제 만들기 부탁 글 (기출이 있으면 그 스타일 예시를 같이 붙임)
function buildPredRequest({ subject, range, past = [] }) {
  const f = FORMATS.pred;
  const L = [];
  L.push(`학습 앱의 예상문제 탭에 넣을 엑셀(.xlsx)을 만들어 줘. 과목은 ${subject}, 범위는 ${range}이야.`);
  L.push('첨부한 수업 자료로 시험에 나올 만한 문제를 만드는 거야. 바로 만들지 말고 아래 순서대로 나랑 먼저 정하고 만들어 줘.', '');
  L.push('[진행 순서]');
  L.push('1단계 정리해서 보여 주기 (아직 파일은 만들지 말 것)');
  L.push('  - 자료별 구성 : 주차나 챕터, 그 안의 작은 제목, PDF 장 범위');
  L.push('  - 출제 계획표 : 자료마다 최대 30문제. 단원별 문항 수를 자료에서 강조된 정도(굵은 글씨, 별표, "중요", 시험 표시, 여러 번 반복된 내용, 교수님이 따로 정리한 표)에 비례해서 나눔. 형식 비율(객관식, OX, 빈칸, 단답)과 난이도(쉬움, 보통, 어려움) 비율도 같이');
  L.push(past.length ? '  - 기출 스타일 분석 : 아래 [기출 예시] 를 보고 형식 비율, 문제 말투, 보기 길이, 난이도, 자주 나온 단원을 정리. 출제 계획은 이 스타일을 따르는 것을 기본으로' : '  - 기출 원본을 같이 첨부했으면 그 스타일(형식 비율, 말투, 난이도, 자주 나온 단원)을 먼저 분석해서 출제 계획에 반영');
  L.push('  - 애매한 것 : 오타, 깨진 글자, 자료끼리 내용이 다른 곳');
  L.push('2단계 질문하기 : 번호를 붙여 질문하고, 질문마다 네 추천안과 이유를 한 줄로. 한 번에 7개 이하, 내가 "1 추천대로, 2 B" 처럼 짧게 답할 수 있게 보기를 A, B 로.');
  if (!past.length) L.push('  - 이 과목은 앱에 기출이 없음. 시험 모양을 먼저 물어볼 것 : 객관식 보기 개수(4지 / 5지), 형식 비율, 교수님이 강조한 부분이나 들은 출제 경향이 있는지. 내가 모른다고 하면 한의대 학년 시험에서 흔한 모양(5지선다 객관식 위주 + 빈칸, 단답 약간)으로 추천');
  L.push('  - 출제 계획표 이대로 갈지 (단원별 문항 수 조정)');
  L.push('  - 형식 비율과 난이도 비율');
  L.push('  - 추천 비율대로 만든 예시 문제 3개 (객관식 2, 빈칸이나 단답 1) 를 보여 주고 이 수준과 말투로 갈지');
  L.push('  - 1단계에서 찾은 애매한 것을 어떻게 할지');
  L.push('3단계 만들기 : 내 답을 반영해서 만들고, 아래 [마지막 검수] 를 한 뒤 결과 맨 위에 정한 내용 요약과 검수 목록을 적어 줘. 내가 "추천대로 해" 라고 하면 추천안 전부로 바로 만들어.', '');
  L.push('[좋은 문제 기준]');
  L.push('- 자료에 근거가 있는 내용만 출제. 자료 밖 지식이 꼭 필요하면 source 에 "자료 밖".');
  L.push('- 한 문제에는 한 개념만. 다른 문제의 지문이나 보기가 이 문제의 답을 알려 주지 않게.');
  L.push('- 유형을 섞음 : 설명을 보고 용어 고르기, 용어를 보고 설명 고르기, 사례나 증상을 보고 판단하기, 짝짓기, 순서, 비슷한 두 개념의 차이, 예외 찾기, 숫자.');
  L.push('- 단어 뜻을 묻는 문제도 넣어도 됨.');
  L.push('[객관식 보기]');
  L.push('- 오답은 헷갈릴 만한 것으로 : 같은 단원의 비슷한 용어, 자주 헷갈리는 짝, 반만 맞는 설명. 말도 안 되는 보기 금지.');
  L.push('- 보기끼리 길이와 말투를 비슷하게. 정답만 길거나 구체적이어서 티 나지 않게.');
  L.push('- 문제 지문에 나온 단어가 정답 보기에만 그대로 나와서 글자 맞추기로 풀리면 안 됨.');
  L.push('- 정답 번호를 고르게 나눔 (자료 하나 안에서 한 번호가 30% 를 넘지 않게).');
  L.push('- "옳지 않은 것" 같은 부정형은 객관식의 20% 이하. "모두 옳다", "정답 없음" 같은 보기는 쓰지 않음.');
  L.push('[빈칸, 단답]');
  L.push('- 답이 한두 단어로 딱 정해지는 것만. 답이 여러 가지로 쓰일 수 있으면 accept 에 넉넉하게.', '');
  L.push('[마지막 검수] 다 만든 뒤 네가 직접 한 번 풀어 보고 확인');
  L.push('- 정답이 하나뿐인지 (객관식에서 다른 보기도 맞을 수 있으면 고치기)');
  L.push('- source 의 장 번호가 실제 근거와 맞는지');
  L.push('- 같은 걸 묻는 문제가 겹치지 않는지, 정답 번호 분포');
  L.push('- 고친 것과 확신이 없는 문제는 검수 목록에 번호와 이유를 적기', '');
  L.push('[결과물] 시트 1개("예상문제")가 든 .xlsx 하나', '- 헤더(첫 줄)는 넣지 말고 1행부터 데이터', '- 칸(열) 순서는 아래 그대로', '');
  L.push(`[예상문제 탭] ${f.cols.length}칸 : ${f.cols.map(([c, d], i) => `(${i + 1})${c} ${d}`).join(', ')}`);
  f.rules.forEach((r) => L.push(`- ${r}`));
  if (past.length) {
    L.push('', `[기출 예시] 이 과목 기출문제 ${past.length}개 중 일부 (스타일 참고용, 그대로 베끼지 말 것)`);
    const T = { mc: '객관식', ox: 'OX', blank: '빈칸', short: '단답', essay: '서술' };
    const cnt = {}; past.forEach((q) => { cnt[T[q.type] || q.type] = (cnt[T[q.type] || q.type] || 0) + 1; });
    L.push(`형식 분포 : ${Object.entries(cnt).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const pick = past.filter((q) => q.type !== 'essay').slice(0, 400);
    const step = Math.max(1, Math.floor(pick.length / 12));
    pick.filter((_, i) => i % step === 0).slice(0, 12).forEach((q, i) => {
      const ch = (q.choices || []).length ? ` / 보기 : ${(q.choices || []).map((c, j) => `${j + 1}) ${c}`).join('  ')}` : '';
      L.push(`${i + 1}. [${T[q.type] || q.type}] ${String(q.question).replace(/\s+/g, ' ').slice(0, 220)}${ch.slice(0, 400)} / 정답 : ${q.answer}`);
    });
  }
  L.push('', '위 형식과 규칙은 기본값이야. 2단계에서 내가 다르게 정한 것이 있으면 그쪽을 따라 줘. 다 만들면 .xlsx 파일로 받게 해 줘.');
  return L.join('\n');
}

  return { FORMATS, formatsFor, buildRequest, buildPastRequest, buildPredRequest };
}
// FORMATS-END
