type Env = { DB: D1Database };

type CleanRow = {
  fingerprint: string; service_id: string; service_name: string; timestamp: string;
  status_code: number; latency_ms: number | null; agent: string; region: string;
  is_valid: number;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
});

function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ""; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function parseTimestamp(value: string): string | null {
  const s = value.trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const ms = Number(s) * 1000; const d = new Date(ms);
    return Number.isFinite(ms) && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
  }
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fingerprint(row: Omit<CleanRow, 'fingerprint'>): string {
  const source = [row.service_id,row.service_name,row.timestamp,row.status_code,row.latency_ms ?? '',row.agent,row.region,row.is_valid].join('|');
  let h1 = 2166136261, h2 = 16777619;
  for (let i = 0; i < source.length; i++) { const c = source.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 16777619); h2 ^= c + i; h2 = Math.imul(h2, 2246822519); }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

function clean(headers: string[], values: string[]): CleanRow | null {
  const r: Record<string,string> = {}; headers.forEach((h,i) => r[h.trim()] = (values[i] ?? '').trim());
  if (!r.service_id || !r.service_name || !r.timestamp || !r.agent || !r.region) return null;
  const timestamp = parseTimestamp(r.timestamp); if (!timestamp) return null;
  const status = Number(r.status_code); if (!Number.isInteger(status)) return null;
  const rawLatency = r.latency === '' ? null : Number(r.latency);
  let latency: number | null = rawLatency;
  if (latency !== null && (!Number.isFinite(latency) || latency < 0)) latency = null;
  if (latency !== null && r.latency_unit.toLowerCase() === 's') latency *= 1000;
  else if (latency !== null && r.latency_unit.toLowerCase() !== 'ms') latency = null;
  const isValid = status !== 999 ? 1 : 0;
  const base = { service_id:r.service_id, service_name:r.service_name, timestamp, status_code:status, latency_ms:latency, agent:r.agent, region:r.region, is_valid:isValid };
  return { ...base, fingerprint: fingerprint(base) };
}

async function upload(request: Request, env: Env) {
  const form = await request.formData(); const file = form.get('file');
  if (!(file instanceof File)) return json({error:'CSV file is required'},400);
  if (file.size > 5_000_000) return json({error:'File must be <= 5 MB'},400);
  const rows = csvRows(await file.text()); if (rows.length < 2) return json({error:'CSV is empty'},400);
  const headers = rows[0].map(x => x.trim());
  const required = ['service_id','service_name','timestamp','status_code','latency','latency_unit','agent','region'];
  if (!required.every(h => headers.includes(h))) return json({error:'Missing required CSV columns'},400);
  const cleaned: CleanRow[] = []; let rejected = 0;
  for (const values of rows.slice(1)) { const r = clean(headers, values); if (r) cleaned.push(r); else rejected++; }
  let inserted = 0;
  for (let i=0;i<cleaned.length;i+=50) {
    const batch = cleaned.slice(i,i+50).map(r => env.DB.prepare(`INSERT OR IGNORE INTO checks (fingerprint,service_id,service_name,timestamp,status_code,latency_ms,agent,region,is_valid) VALUES (?,?,?,?,?,?,?,?,?)`).bind(r.fingerprint,r.service_id,r.service_name,r.timestamp,r.status_code,r.latency_ms,r.agent,r.region,r.is_valid));
    const results = await env.DB.batch(batch); inserted += results.filter(x => x.success).length;
  }
  return json({filename:file.name, received:rows.length-1, parsed:cleaned.length, inserted, rejected, duplicates:(cleaned.length-inserted)});
}

function range(request: Request) {
  const u = new URL(request.url); const from = u.searchParams.get('from'); const to = u.searchParams.get('to');
  const clauses: string[] = []; const params: string[] = [];
  if (from) { clauses.push('timestamp >= ?'); params.push(`${from}T00:00:00.000Z`); }
  if (to) { clauses.push('timestamp < ?'); params.push(`${to}T23:59:59.999Z`); }
  return {where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params};
}

async function stats(request: Request, env: Env) {
  const {where,params}=range(request); const base=await env.DB.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN is_valid=1 AND status_code=200 THEN 1 ELSE 0 END) success, SUM(CASE WHEN is_valid=1 AND status_code IN (500,502,503) THEN 1 ELSE 0 END) failed, SUM(CASE WHEN is_valid=0 THEN 1 ELSE 0 END) invalid, AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END) avg_latency FROM checks ${where}`).bind(...params).first<any>();
  const latencyWhere = where ? `${where} AND latency_ms IS NOT NULL` : 'WHERE latency_ms IS NOT NULL';
  const rows=await env.DB.prepare(`SELECT latency_ms FROM checks ${latencyWhere} ORDER BY latency_ms`).bind(...params).all<any>();
  const vals=(rows.results??[]).map(r=>Number(r.latency_ms)); const p95=vals.length?vals[Math.min(vals.length-1,Math.ceil(vals.length*.95)-1)]:null;
  const availability=base?.total ? ((Number(base.success||0)/Number(base.total||1))*100) : 0;
  return json({...base,availability,p95_latency:p95});
}

async function logs(request: Request, env: Env) {
  const {where,params}=range(request); const u=new URL(request.url); const limit=Math.min(Number(u.searchParams.get('limit')||200),500); const offset=Math.max(Number(u.searchParams.get('offset')||0),0);
  const result=await env.DB.prepare(`SELECT id,service_id,service_name,timestamp,status_code,latency_ms,agent,region,is_valid FROM checks ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).bind(...params,limit,offset).all();
  return json({rows:result.results,limit,offset});
}

export default { async fetch(request:Request, env:Env):Promise<Response> {
  if (request.method==='OPTIONS') return new Response(null,{headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'}});
  const url=new URL(request.url);
  try {
    if (url.pathname==='/api/health') return json({ok:true});
    if (url.pathname==='/api/upload' && request.method==='POST') return upload(request,env);
    if (url.pathname==='/api/stats') return stats(request,env);
    if (url.pathname==='/api/logs') return logs(request,env);
    return json({error:'Not found'},404);
  } catch(e) { return json({error:e instanceof Error?e.message:'Unexpected error'},500); }
}};
