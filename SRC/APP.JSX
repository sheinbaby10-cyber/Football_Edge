import { useState, useEffect, useCallback } from "react";

const ODDS_API_KEY = import.meta.env.VITE_ODDS_API_KEY;
const SPORT = "soccer_epl";

const STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0e1a; color: #e2e8f0; font-family: 'Inter', sans-serif; }
`;

// ── Poisson helpers ──────────────────────────────────────────────
function poissonPMF(lambda, k) {
  let logP = -lambda + k * Math.log(Math.max(lambda, 1e-9));
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function buildMatrix(lh, la, max = 8) {
  const M = [];
  for (let i = 0; i <= max; i++) {
    M[i] = [];
    for (let j = 0; j <= max; j++) M[i][j] = poissonPMF(lh, i) * poissonPMF(la, j);
  }
  return M;
}

function matrixProbs(M) {
  let home = 0, draw = 0, away = 0, over25 = 0, btts = 0;
  for (let i = 0; i < M.length; i++) {
    for (let j = 0; j < M[i].length; j++) {
      const p = M[i][j];
      if (i > j) home += p; else if (i === j) draw += p; else away += p;
      if (i + j > 2.5) over25 += p;
      if (i > 0 && j > 0) btts += p;
    }
  }
  return { home, draw, away, over25, under25: 1 - over25, bttsYes: btts, bttsNo: 1 - btts };
}

// ── Derive lambdas from 1X2 odds (no external API needed) ────────
// Uses the implied probs as targets and solves numerically
function impliedProbs(oh, od, oa) {
  const vig = 1 / oh + 1 / od + 1 / oa;
  return { ph: 1 / oh / vig, pd: 1 / od / vig, pa: 1 / oa / vig };
}

function poissonProbs(lh, la) {
  let home = 0, draw = 0, away = 0;
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const p = poissonPMF(lh, i) * poissonPMF(la, j);
      if (i > j) home += p; else if (i === j) draw += p; else away += p;
    }
  }
  return { home, draw, away };
}

function deriveLambdas(oh, od, oa) {
  const target = impliedProbs(oh, od, oa);
  // Grid search: lh in [0.5, 4.0], la in [0.4, 3.0]
  let best = { lh: 1.4, la: 1.1, err: Infinity };
  for (let lh = 0.5; lh <= 4.0; lh += 0.05) {
    for (let la = 0.4; la <= 3.0; la += 0.05) {
      const p = poissonProbs(lh, la);
      const err = Math.pow(p.home - target.ph, 2) +
                  Math.pow(p.draw - target.pd, 2) +
                  Math.pow(p.away - target.pa, 2);
      if (err < best.err) best = { lh, la, err };
    }
  }
  return { lambdaHome: best.lh, lambdaAway: best.la };
}

// ── EV ───────────────────────────────────────────────────────────
function calcEV(prob, odds) { return prob * odds - 1; }

// ── UI helpers ───────────────────────────────────────────────────
function evColor(ev) {
  if (ev >= 0.08) return "#00e676";
  if (ev >= 0.03) return "#69f0ae";
  if (ev > 0)     return "#b9f6ca";
  return "#ef5350";
}
function evLabel(ev) {
  if (ev >= 0.08) return "🔥 STRONG VALUE";
  if (ev >= 0.03) return "✅ VALUE";
  if (ev > 0)     return "⚠️ SLIGHT EDGE";
  return "❌ NO VALUE";
}
function ProbBar({ prob }) {
  const pct = Math.round(prob * 100);
  const col = pct > 55 ? "#4fc3f7" : pct > 38 ? "#81d4fa" : "#b0bec5";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, background: "#1a2035", borderRadius: 4, height: 8 }}>
        <div style={{ width: `${pct}%`, background: col, height: "100%", borderRadius: 4, transition: "width 0.6s" }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, minWidth: 36 }}>{pct}%</span>
    </div>
  );
}

// ── Fixture Card ─────────────────────────────────────────────────
function FixtureCard({ fixture, onAnalyse, result }) {
  const ko = new Date(fixture.commence_time);
  const timeStr = ko.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const dateStr = ko.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div style={{
      background: "#111827", border: "1px solid #1f2937", borderRadius: 16,
      padding: "20px 24px", marginBottom: 16,
    }}>
      {/* Match header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
            Premier League · {dateStr} · {timeStr}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {fixture.home_team} <span style={{ color: "#374151" }}>vs</span> {fixture.away_team}
          </div>
        </div>
        <button
          onClick={() => onAnalyse(fixture)}
          disabled={result?.loading}
          style={{
            background: result ? "#1f2937" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
            color: "#fff", border: "none", borderRadius: 10,
            padding: "10px 20px", fontSize: 13, fontWeight: 600,
            cursor: result?.loading ? "wait" : "pointer",
          }}
        >
          {result?.loading ? "Analysing…" : result ? "Re-analyse" : "Analyse ⚡"}
        </button>
      </div>

      {/* Odds pills */}
      {fixture.odds && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: result ? 20 : 0 }}>
          {[
            ["Home", fixture.odds.home], ["Draw", fixture.odds.draw], ["Away", fixture.odds.away],
            ["O2.5", fixture.odds.over25], ["U2.5", fixture.odds.under25],
          ].map(([label, odds]) => odds && (
            <div key={label} style={{
              background: "#1a2035", borderRadius: 8, padding: "6px 12px", fontSize: 12, textAlign: "center",
            }}>
              <div style={{ color: "#6b7280", marginBottom: 2 }}>{label}</div>
              <div style={{ fontWeight: 700 }}>{typeof odds === "number" ? odds.toFixed(2) : odds}</div>
            </div>
          ))}
        </div>
      )}

      {/* Analysis */}
      {result && !result.loading && !result.error && (
        <div style={{ borderTop: "1px solid #1f2937", paddingTop: 20 }}>
          {/* xG row */}
          <div style={{
            display: "flex", gap: 0, marginBottom: 20,
            background: "#0d1117", borderRadius: 10, overflow: "hidden",
          }}>
            <div style={{ flex: 1, padding: "14px 0", textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>HOME xG</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#4fc3f7" }}>
                {result.lambdaHome.toFixed(2)}
              </div>
            </div>
            <div style={{ width: 1, background: "#1f2937" }} />
            <div style={{ flex: 1, padding: "14px 0", textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>AWAY xG</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#f48fb1" }}>
                {result.lambdaAway.toFixed(2)}
              </div>
            </div>
            <div style={{ width: 1, background: "#1f2937" }} />
            <div style={{ flex: 2, padding: "14px 20px", display: "flex", alignItems: "center" }}>
              <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.6 }}>
                xG derived from market odds using Poisson calibration.
                Model finds fair value vs bookmaker margin.
              </div>
            </div>
          </div>

          {/* Markets */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(195px,1fr))", gap: 10 }}>
            {result.markets.map(m => (
              <div key={m.key} style={{
                background: "#0d1117", borderRadius: 10, padding: "14px 16px",
                border: `1px solid ${m.ev >= 0.03 ? "#065f46" : "#1f2937"}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600 }}>{m.label}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6,
                    background: m.ev >= 0.03 ? "#064e3b" : "#1f2937",
                    color: evColor(m.ev),
                  }}>{evLabel(m.ev)}</span>
                </div>
                <ProbBar prob={m.modelProb} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12 }}>
                  <span style={{ color: "#6b7280" }}>Odds <b style={{ color: "#f9fafb" }}>{m.odds.toFixed(2)}</b></span>
                  <span style={{ color: evColor(m.ev), fontWeight: 700 }}>EV {(m.ev * 100).toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>

          {/* Best bet banner */}
          {result.bestBet && (
            <div style={{
              marginTop: 14, background: "#064e3b", borderRadius: 10,
              padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: 11, color: "#6ee7b7", marginBottom: 3 }}>🏆 HIGHEST VALUE BET</div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  {fixture.home_team} vs {fixture.away_team} — {result.bestBet.label}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#00e676" }}>
                  +{(result.bestBet.ev * 100).toFixed(1)}% EV
                </div>
                <div style={{ fontSize: 12, color: "#6ee7b7" }}>@ {result.bestBet.odds.toFixed(2)}</div>
              </div>
            </div>
          )}

          {result.valueBets.length === 0 && (
            <div style={{ marginTop: 14, background: "#1a0000", borderRadius: 10, padding: "12px 16px",
              color: "#ef5350", fontSize: 13 }}>
              No value found — bookmaker prices are efficient for this match.
            </div>
          )}
        </div>
      )}

      {result?.error && (
        <div style={{ color: "#ef5350", fontSize: 13, marginTop: 12 }}>Error: {result.error}</div>
      )}
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────
export default function App() {
  const [fixtures, setFixtures] = useState([]);
  const [results,  setResults]  = useState({});
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [filter,   setFilter]   = useState("all");

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const url = `https://api.the-odds-api.com/v4/sports/${SPORT}/odds/?apiKey=${ODDS_API_KEY}&regions=uk&markets=h2h,totals&oddsFormat=decimal`;
        const res  = await fetch(url);
        if (!res.ok) throw new Error(`Odds API ${res.status} — check your API key in Vercel env vars`);
        const data = await res.json();

        const parsed = data.map(ev => {
          const getAvg = (mktKey, name, point) => {
            const prices = ev.bookmakers?.flatMap(b =>
              b.markets?.filter(m => m.key === mktKey)
                .flatMap(m => m.outcomes?.filter(o =>
                  o.name === name && (point == null || Math.abs((o.point || 0) - point) < 0.01)
                ).map(o => o.price) ?? []) ?? []
            ) ?? [];
            return prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
          };
          return {
            id: ev.id, home_team: ev.home_team, away_team: ev.away_team,
            commence_time: ev.commence_time,
            odds: {
              home: getAvg("h2h", ev.home_team), draw: getAvg("h2h", "Draw"),
              away: getAvg("h2h", ev.away_team),
              over25:  getAvg("totals", "Over",  2.5),
              under25: getAvg("totals", "Under", 2.5),
            },
          };
        }).filter(f => f.odds.home && f.odds.draw && f.odds.away)
          .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));

        setFixtures(parsed);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  const analyseFixture = useCallback(async (fixture) => {
    setResults(prev => ({ ...prev, [fixture.id]: { loading: true } }));
    try {
      // Derive lambdas from bookmaker odds (no external API needed)
      const { lambdaHome, lambdaAway } = deriveLambdas(
        fixture.odds.home, fixture.odds.draw, fixture.odds.away
      );
      const M     = buildMatrix(lambdaHome, lambdaAway);
      const probs = matrixProbs(M);

      const mkts = [
        { key: "hw",   label: "Home Win",  modelProb: probs.home,    odds: fixture.odds.home },
        { key: "dr",   label: "Draw",      modelProb: probs.draw,    odds: fixture.odds.draw },
        { key: "aw",   label: "Away Win",  modelProb: probs.away,    odds: fixture.odds.away },
        { key: "o25",  label: "Over 2.5",  modelProb: probs.over25,  odds: fixture.odds.over25  || 1.9 },
        { key: "u25",  label: "Under 2.5", modelProb: probs.under25, odds: fixture.odds.under25 || 1.9 },
        { key: "byes", label: "BTTS Yes",  modelProb: probs.bttsYes, odds: 1.90 },
        { key: "bno",  label: "BTTS No",   modelProb: probs.bttsNo,  odds: 1.90 },
      ].filter(m => m.odds).map(m => ({ ...m, ev: calcEV(m.modelProb, m.odds) }));

      const valueBets = mkts.filter(m => m.ev >= 0.03).sort((a, b) => b.ev - a.ev);

      setResults(prev => ({
        ...prev,
        [fixture.id]: { lambdaHome, lambdaAway, markets: mkts, valueBets, bestBet: valueBets[0] || null },
      }));
    } catch (e) {
      setResults(prev => ({ ...prev, [fixture.id]: { error: e.message } }));
    }
  }, []);

  const today = new Date().toDateString();
  const shown  = filter === "today"
    ? fixtures.filter(f => new Date(f.commence_time).toDateString() === today)
    : fixtures;

  const analysed   = Object.values(results).filter(r => r && !r.loading && !r.error);
  const valueBets  = analysed.flatMap(r => r.valueBets || []);

  return (
    <>
      <style>{STYLES}</style>
      <div style={{ minHeight: "100vh", background: "#0a0e1a" }}>
        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%)",
          borderBottom: "1px solid #1f2937", padding: "22px 0 20px",
        }}>
          <div style={{ maxWidth: 920, margin: "0 auto", padding: "0 20px",
            display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, color: "#6366f1", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>
                Phase 1 · Validation Engine
              </div>
              <div style={{ fontSize: 26, fontWeight: 800 }}>⚽ Football Edge</div>
              <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>
                Poisson Model · EV Engine · Premier League
              </div>
            </div>
            {analysed.length > 0 && (
              <div style={{ display: "flex", gap: 28 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#4fc3f7" }}>{analysed.length}</div>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>ANALYSED</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#00e676" }}>{valueBets.length}</div>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>VALUE BETS</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ maxWidth: 920, margin: "0 auto", padding: "24px 20px" }}>
          {/* Filter */}
          <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
            {["all", "today"].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                background: filter === f ? "#6366f1" : "#111827",
                color: filter === f ? "#fff" : "#6b7280",
                border: "none", borderRadius: 8, padding: "8px 18px",
                fontSize: 13, fontWeight: 600, cursor: "pointer", textTransform: "capitalize",
              }}>{f === "all" ? "All Fixtures" : "Today"}</button>
            ))}
            <div style={{ marginLeft: "auto", fontSize: 12, color: "#374151", alignSelf: "center" }}>
              {shown.length} fixtures
            </div>
          </div>

          {loading && (
            <div style={{ textAlign: "center", padding: 60, color: "#6b7280" }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>⚽</div>
              Loading fixtures and odds…
            </div>
          )}

          {error && (
            <div style={{
              background: "#1f0000", border: "1px solid #7f1d1d",
              borderRadius: 12, padding: 20, color: "#fca5a5",
            }}>
              <b>Could not load fixtures:</b><br />{error}
            </div>
          )}

          {!loading && !error && shown.length === 0 && (
            <div style={{ textAlign: "center", padding: 60, color: "#6b7280" }}>
              No upcoming Premier League fixtures right now.
            </div>
          )}

          {shown.map(fixture => (
            <FixtureCard
              key={fixture.id}
              fixture={fixture}
              onAnalyse={analyseFixture}
              result={results[fixture.id]}
            />
          ))}
        </div>
      </div>
    </>
  );
}
