// 공부하니 전용 Claude 커넥터 (원격 MCP 서버)
//  - Claude 채팅에서 만든 데이터를 "검토 대기"(import_drafts) 로만 올림. 실제 데이터는 앱에서 확인하고 넣어야 바뀜
//  - 할 수 있는 것 : 내가 담당하는 과목 보기, 만드는 규칙 받기, 자료 파일 이름 보기, 검토 대기에 올리기
//  - 못 하는 것 : 지우기, 고치기, 회원 정보 보기
//  - 열쇠 : 앱 설정에서 만든 kmed_ 로 시작하는 열쇠. 주소의 ?key= 또는 Authorization: Bearer 로 받음 (DB 에는 sha256 만)
//  - 배포할 때 "Verify JWT" 는 꺼야 함 (Claude 는 Supabase 로그인 토큰이 없음)
import { createClient } from 'jsr:@supabase/supabase-js@2';
// 배포할 때 함께 묶이는 형식 규칙 (아래 실시간 불러오기가 안 될 때 씀)
import * as BUNDLED from 'https://kiky-wku.github.io/KMED-Archive/js/data/formats.js';

const VERSION = '1.0.0';
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
  let f = BUNDLED as unknown as Fmt;
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
      let q = svc.from('files').select('filename,range_id,category,created_at').eq('subject_id', String(a.subject_id)).order('created_at');
      if (a.range_id) q = q.eq('range_id', String(a.range_id));
      const { data } = await q;
      return (data || []).length ? (data || []).map((x) => `- ${x.filename}`).join('\n') : '올라간 PDF 가 없습니다. 사용자가 채팅에 올린 파일 이름을 쓰세요.';
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
