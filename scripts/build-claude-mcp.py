# claude-mcp 함수 안의 formats.js 사본을 지금 것으로 바꿈 : python3 scripts/build-claude-mcp.py
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
fmt = (root / 'js/data/formats.js').read_text()
body = re.sub(r'^export\s+', '', fmt, flags=re.M)
block = ('// FORMATS-START\nfunction bundledFormats() {\n' + body +
         '\n  return { FORMATS, formatsFor, buildRequest, buildPastRequest, buildPredRequest };\n}\n// FORMATS-END')
p = root / 'supabase/functions/claude-mcp/index.ts'
s = p.read_text()
s = re.sub(r'// FORMATS-START.*?// FORMATS-END', lambda m: block, s, flags=re.S)
p.write_text(s)
print('ok', len(s))
