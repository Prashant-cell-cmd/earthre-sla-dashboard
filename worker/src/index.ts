type Env = {
  DB: D1Database;
};

type CleanRow = {
  fingerprint: string;
  service_id: string;
  service_name: string;
  timestamp: string;
  status_code: number;
  latency_ms: number | null;
  agent: string;
  region: string;
  is_valid: number;
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function parseTimestamp(value: string): string | null {
  const s = value.trim();

  // Unix timestamp in seconds
  if (/^\d+(\.\d+)?$/.test(s)) {
    const ms = Number(s) * 1000;
    const d = new Date(ms);

    if (
      !Number.isFinite(ms) ||
      Number.isNaN(d.getTime())
    ) {
      return null;
    }

    return d.toISOString();
  }

  // ISO timestamp
  const d = new Date(s);

  if (Number.isNaN(d.getTime())) {
    return null;
  }

  return d.toISOString();
}

function makeFingerprint(
  row: Omit<CleanRow, "fingerprint">
): string {
  const source = [
    row.service_id,
    row.service_name,
    row.timestamp,
    row.status_code,
    row.latency_ms ?? "",
    row.agent,
    row.region,
    row.is_valid,
  ].join("|");

  let h1 = 2166136261;
  let h2 = 16777619;

  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);

    h1 ^= c;
    h1 = Math.imul(h1, 16777619);

    h2 ^= c + i;
    h2 = Math.imul(h2, 2246822519);
  }

  return `${(h1 >>> 0).toString(16)}${(
    h2 >>> 0
  ).toString(16)}`;
}

function clean(
  headers: string[],
  values: string[]
): CleanRow | null {
  const r: Record<string, string> = {};

  headers.forEach((h, i) => {
    r[h.trim()] = (values[i] ?? "").trim();
  });

  // Required fields
  if (
    !r.service_id ||
    !r.service_name ||
    !r.timestamp ||
    !r.agent ||
    !r.region
  ) {
    return null;
  }

  const timestamp = parseTimestamp(r.timestamp);

  if (!timestamp) {
    return null;
  }

  const status = Number(r.status_code);

  if (!Number.isInteger(status)) {
    return null;
  }

  // Latency
  let latency: number | null =
    r.latency === ""
      ? null
      : Number(r.latency);

  // Missing, negative or invalid latency => NULL
  if (
    latency !== null &&
    (!Number.isFinite(latency) || latency < 0)
  ) {
    latency = null;
  }

  const unit = r.latency_unit.toLowerCase();

  // Convert seconds to milliseconds
  if (latency !== null && unit === "s") {
    latency = latency * 1000;
  }

  // Unknown latency unit => NULL
  if (
    latency !== null &&
    unit !== "ms" &&
    unit !== "s"
  ) {
    latency = null;
  }

  // 999 = invalid
  const isValid = status === 999 ? 0 : 1;

  const base = {
    service_id: r.service_id,
    service_name: r.service_name,
    timestamp,
    status_code: status,
    latency_ms: latency,
    agent: r.agent,
    region: r.region,
    is_valid: isValid,
  };

  return {
    ...base,
    fingerprint: makeFingerprint(base),
  };
}

/*
 * Upload CSV
 *
 * Important:
 * We process the file in small chunks.
 * Each chunk uses D1 batch().
 *
 * This keeps the number of D1 statements per
 * batch within a conservative limit.
 */
async function upload(
  request: Request,
  env: Env
) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return json(
      { error: "CSV file is required" },
      400
    );
  }

  if (file.size > 5_000_000) {
    return json(
      { error: "File must be <= 5 MB" },
      400
    );
  }

  const text = await file.text();
  const rows = csvRows(text);

  if (rows.length < 2) {
    return json(
      { error: "CSV is empty" },
      400
    );
  }

  const headers = rows[0].map((x) =>
    x.trim()
  );

  const required = [
    "service_id",
    "service_name",
    "timestamp",
    "status_code",
    "latency",
    "latency_unit",
    "agent",
    "region",
  ];

  const missingColumns = required.filter(
    (column) => !headers.includes(column)
  );

  if (missingColumns.length > 0) {
    return json(
      {
        error: "Missing required CSV columns",
        missing: missingColumns,
      },
      400
    );
  }

  const cleaned: CleanRow[] = [];
  let rejected = 0;

  for (const values of rows.slice(1)) {
    const cleanedRow = clean(
      headers,
      values
    );

    if (cleanedRow) {
      cleaned.push(cleanedRow);
    } else {
      rejected++;
    }
  }

  let inserted = 0;
  let duplicates = 0;

  /*
   * D1 batch size = 25.
   *
   * We deliberately keep this small because
   * Cloudflare local/Worker environments can
   * enforce invocation/API limits.
   */
  const BATCH_SIZE = 25;

  for (
    let start = 0;
    start < cleaned.length;
    start += BATCH_SIZE
  ) {
    const batchRows = cleaned.slice(
      start,
      start + BATCH_SIZE
    );

    const statements = batchRows.map((row) =>
      env.DB
        .prepare(
          `INSERT OR IGNORE INTO checks
          (
            fingerprint,
            service_id,
            service_name,
            timestamp,
            status_code,
            latency_ms,
            agent,
            region,
            is_valid
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          row.fingerprint,
          row.service_id,
          row.service_name,
          row.timestamp,
          row.status_code,
          row.latency_ms,
          row.agent,
          row.region,
          row.is_valid
        )
    );

    const results =
      await env.DB.batch(statements);

    for (const result of results) {
      const changes = Number(
        result.meta?.changes ?? 0
      );

      if (changes > 0) {
        inserted += changes;
      } else {
        duplicates++;
      }
    }
  }

  return json({
    filename: file.name,
    received: rows.length - 1,
    parsed: cleaned.length,
    inserted,
    duplicates,
    rejected,
  });
}

function range(request: Request) {
  const url = new URL(request.url);

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const clauses: string[] = [];
  const params: string[] = [];

  if (from) {
    clauses.push("timestamp >= ?");
    params.push(
      `${from}T00:00:00.000Z`
    );
  }

  if (to) {
    clauses.push("timestamp <= ?");
    params.push(
      `${to}T23:59:59.999Z`
    );
  }

  return {
    where:
      clauses.length > 0
        ? `WHERE ${clauses.join(" AND ")}`
        : "",
    params,
  };
}

async function stats(
  request: Request,
  env: Env
) {
  const { where, params } =
    range(request);

  const base = await env.DB
    .prepare(
      `SELECT
        COUNT(*) AS total,

        SUM(
          CASE
            WHEN is_valid = 1
            AND status_code = 200
            THEN 1
            ELSE 0
          END
        ) AS success,

        SUM(
          CASE
            WHEN is_valid = 1
            AND status_code IN (500, 502, 503)
            THEN 1
            ELSE 0
          END
        ) AS failed,

        SUM(
          CASE
            WHEN is_valid = 0
            THEN 1
            ELSE 0
          END
        ) AS invalid,

        AVG(
          CASE
            WHEN latency_ms IS NOT NULL
            THEN latency_ms
          END
        ) AS avg_latency

      FROM checks
      ${where}`
    )
    .bind(...params)
    .first<any>();

  const latencyWhere = where
    ? `${where} AND latency_ms IS NOT NULL`
    : "WHERE latency_ms IS NOT NULL";

  const latencyRows = await env.DB
    .prepare(
      `SELECT latency_ms
       FROM checks
       ${latencyWhere}
       ORDER BY latency_ms`
    )
    .bind(...params)
    .all<any>();

  const values = (
    latencyRows.results ?? []
  )
    .map((row) => Number(row.latency_ms))
    .filter((value) =>
      Number.isFinite(value)
    );

  let p95: number | null = null;

  if (values.length > 0) {
    const index = Math.min(
      values.length - 1,
      Math.ceil(
        values.length * 0.95
      ) - 1
    );

    p95 = values[index];
  }

  const total = Number(
    base?.total || 0
  );

  const success = Number(
    base?.success || 0
  );

  const availability =
    total > 0
      ? (success / total) * 100
      : 0;

  return json({
    total,
    success,
    failed: Number(
      base?.failed || 0
    ),
    invalid: Number(
      base?.invalid || 0
    ),
    avg_latency:
      base?.avg_latency == null
        ? null
        : Number(base.avg_latency),
    availability,
    p95_latency: p95,
  });
}

async function logs(
  request: Request,
  env: Env
) {
  const { where, params } =
    range(request);

  const url = new URL(request.url);

  const requestedLimit = Number(
    url.searchParams.get("limit") || 200
  );

  const limit = Math.min(
    Math.max(requestedLimit, 1),
    500
  );

  const requestedOffset = Number(
    url.searchParams.get("offset") || 0
  );

  const offset = Math.max(
    requestedOffset,
    0
  );

  const result = await env.DB
    .prepare(
      `SELECT
        id,
        service_id,
        service_name,
        timestamp,
        status_code,
        latency_ms,
        agent,
        region,
        is_valid
      FROM checks
      ${where}
      ORDER BY timestamp DESC
      LIMIT ?
      OFFSET ?`
    )
    .bind(
      ...params,
      limit,
      offset
    )
    .all();

  return json({
    rows: result.results ?? [],
    limit,
    offset,
  });
}

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods":
            "GET,POST,OPTIONS",
          "access-control-allow-headers":
            "content-type",
        },
      });
    }

    const url = new URL(
      request.url
    );

    try {
      // Health check
      if (
        url.pathname === "/api/health"
      ) {
        return json({ ok: true });
      }

      // CSV upload
      if (
        url.pathname === "/api/upload" &&
        request.method === "POST"
      ) {
        return await upload(
          request,
          env
        );
      }

      // Dashboard statistics
      if (
        url.pathname === "/api/stats"
      ) {
        return await stats(
          request,
          env
        );
      }

      // Dashboard logs
      if (
        url.pathname === "/api/logs"
      ) {
        return await logs(
          request,
          env
        );
      }

      return json(
        { error: "Not found" },
        404
      );
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unexpected error",
        },
        500
      );
    }
  },
};