import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const API =
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8787";

type Log = {
  id: number;
  service_name: string;
  timestamp: string;
  status_code: number;
  latency_ms: number | null;
  agent: string;
  region: string;
  is_valid: number;
};

type Stats = {
  total: number;
  success: number;
  failed: number;
  invalid: number;
  avg_latency: number | null;
  availability: number;
  p95_latency: number | null;
};

function App() {
  const [open, setOpen] = useState(true);
  const [file, setFile] = useState<File | null>(null);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [stats, setStats] = useState<Stats | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const query = async () => {
    setLoading(true);

    try {
      const p = new URLSearchParams();

      if (from) {
        p.set("from", from);
      }

      if (to) {
        p.set("to", to);
      }

      const [statsResponse, logsResponse] =
        await Promise.all([
          fetch(`${API}/api/stats?${p}`),
          fetch(`${API}/api/logs?${p}&limit=200`),
        ]);

      if (!statsResponse.ok) {
        throw new Error("Failed to load statistics");
      }

      if (!logsResponse.ok) {
        throw new Error("Failed to load logs");
      }

      const statsData = await statsResponse.json();
      const logsData = await logsResponse.json();

      setStats(statsData);
      setLogs(logsData.rows || []);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to load dashboard"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    query();
  }, [from, to]);

  const upload = async () => {
    if (!file || uploading) {
      return;
    }

    setUploading(true);
    setMessage("Uploading and processing...");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(
        `${API}/api/upload`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Upload failed"
        );
      }

      setMessage(
        `Processed ${data.parsed} rows. ` +
          `Inserted ${data.inserted}; ` +
          `duplicates ${data.duplicates}; ` +
          `rejected ${data.rejected}.`
      );

      setFile(null);

      const fileInput =
        document.getElementById(
          "csv-upload"
        ) as HTMLInputElement | null;

      if (fileInput) {
        fileInput.value = "";
      }

      await query();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Upload failed"
      );
    } finally {
      setUploading(false);
    }
  };

  const clearFilters = () => {
    setFrom("");
    setTo("");
  };

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">
            EarthRe • SLA Monitoring
          </p>

          <h1>Health Check Dashboard</h1>

          <p className="muted">
            Upload monitoring logs, clean them in
            the cloud, and inspect availability.
          </p>
        </div>

        <div className="upload">
          <input
            id="csv-upload"
            type="file"
            accept=".csv"
            onChange={(event) =>
              setFile(
                event.target.files?.[0] || null
              )
            }
          />

          <button
            onClick={upload}
            disabled={!file || uploading}
          >
            {uploading
              ? "Uploading..."
              : "Upload CSV"}
          </button>
        </div>
      </header>

      <section className="filters">
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(event) =>
              setFrom(event.target.value)
            }
          />
        </label>

        <label>
          To
          <input
            type="date"
            value={to}
            onChange={(event) =>
              setTo(event.target.value)
            }
          />
        </label>

        <button
          className="secondary"
          onClick={clearFilters}
        >
          Clear
        </button>
      </section>

      <section className="card">
        <button
          className="collapse"
          onClick={() => setOpen(!open)}
        >
          <span>Statistics</span>

          <span>
            {open ? "▲" : "▼"}
          </span>
        </button>

        {open && (
          <>
            {loading && !stats ? (
              <div className="empty-state">
                Loading statistics...
              </div>
            ) : stats ? (
              <div className="stats">
                <div className="stat">
                  <span>Availability</span>
                  <strong>
                    {Number(
                      stats.availability || 0
                    ).toFixed(3)}
                    %
                  </strong>
                </div>

                <div className="stat">
                  <span>Total checks</span>
                  <strong>
                    {stats.total}
                  </strong>
                </div>

                <div className="stat">
                  <span>Successful</span>
                  <strong>
                    {stats.success}
                  </strong>
                </div>

                <div className="stat">
                  <span>Failed</span>
                  <strong>
                    {stats.failed}
                  </strong>
                </div>

                <div className="stat">
                  <span>Invalid</span>
                  <strong>
                    {stats.invalid}
                  </strong>
                </div>

                <div className="stat">
                  <span>Avg latency</span>
                  <strong>
                    {Number(
                      stats.avg_latency || 0
                    ).toFixed(1)}{" "}
                    ms
                  </strong>
                </div>

                <div className="stat">
                  <span>P95 latency</span>
                  <strong>
                    {stats.p95_latency == null
                      ? "—"
                      : `${Number(
                          stats.p95_latency
                        ).toFixed(1)} ms`}
                  </strong>
                </div>
              </div>
            ) : (
              <div className="empty-state">
                No statistics available.
              </div>
            )}
          </>
        )}
      </section>

      <section className="card">
        <div className="section-title">
          <h2>Logs</h2>

          <span>
            {logs.length} shown
          </span>
        </div>

        <div className="table-wrap">
          {loading && logs.length === 0 ? (
            <div className="empty-state">
              Loading logs...
            </div>
          ) : logs.length === 0 ? (
            <div className="empty-state">
              No logs found for the selected
              date range.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Service</th>
                  <th>Status</th>
                  <th>Latency</th>
                  <th>Agent</th>
                  <th>Region</th>
                </tr>
              </thead>

              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>
                      {new Date(
                        log.timestamp
                      ).toLocaleString()}
                    </td>

                    <td>
                      {log.service_name}
                    </td>

                    <td>
                      <span
                        className={`badge ${
                          log.is_valid
                            ? "ok"
                            : "invalid"
                        }`}
                      >
                        {log.status_code}
                      </span>
                    </td>

                    <td>
                      {log.latency_ms == null
                        ? "—"
                        : `${Number(
                            log.latency_ms
                          ).toFixed(1)} ms`}
                    </td>

                    <td>
                      {log.agent}
                    </td>

                    <td>
                      {log.region}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {message && (
        <div className="toast">
          {message}
        </div>
      )}
    </main>
  );
}

createRoot(
  document.getElementById("root")!
).render(<App />);