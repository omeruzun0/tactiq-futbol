"use client";

import React, { useMemo, useState } from "react";
import { evaluateCountLine, evaluateOutcome, fmtLine } from "@/lib/football/markets";
import {
  AnalysisResult,
  CountFamily,
  EvaluatedPick,
  FEATURE_LABELS,
  FeatureKey,
  MarketGroup,
  Metric,
  PlayerImpactProfile,
  SimilarMatch,
} from "@/lib/football/types";
import { AlertTriangle, Calculator, ShieldCheck, Target, UserMinus, Users, Zap } from "lucide-react";

const GROUPS: MarketGroup[] = ["Maç Sonucu", "Goller", "Faul", "Korner", "Kart", "Şut", "Ofsayt"];

function confColor(c: number) {
  if (c >= 78) return "text-emerald-400";
  if (c >= 68) return "text-lime-400";
  if (c >= 58) return "text-amber-400";
  return "text-rose-400";
}

function confLabel(c: number) {
  if (c >= 78) return "Çok güvenilir";
  if (c >= 68) return "Güvenilir";
  if (c >= 58) return "Orta";
  return "Riskli";
}

function PickCard({ pick, rank }: { pick: EvaluatedPick; rank?: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400">
        <span>
          {rank !== undefined && <strong className="mr-1 text-slate-300">#{rank}</strong>}
          {pick.group}
        </span>
        <span className={`font-bold ${confColor(pick.confidence)}`}>
          {confLabel(pick.confidence)} • {pick.confidence}
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-white">{pick.label}</span>
        <span className="text-base font-extrabold text-emerald-400">%{pick.probability.toFixed(1)}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-400">
        {pick.hitTotal > 0 && (
          <span>
            Benzer maçlarda: <strong className="text-slate-200">{pick.hitCount}/{pick.hitTotal}</strong>
          </span>
        )}
        {pick.hitRate !== null && <span>Ağırlıklı isabet: %{pick.hitRate.toFixed(0)}</span>}
        <span>Adil oran: {pick.fairOdds.toFixed(2)}</span>
      </div>
    </div>
  );
}

function BetChecker({ families }: { families: CountFamily[] }) {
  const [famKey, setFamKey] = useState(families.find((f) => f.key.startsWith("fouls:home"))?.key ?? families[0]?.key);
  const fam = families.find((f) => f.key === famKey) ?? families[0];
  const [line, setLine] = useState<number>(fam ? Math.max(0.5, Math.round(fam.mean) - 0.5) : 0.5);
  const [dir, setDir] = useState<"over" | "under">("over");

  if (!fam) return null;
  const pick = evaluateCountLine(fam, line, dir);

  return (
    <div className="rounded-2xl border border-cyan-500/30 bg-cyan-950/10 p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold text-white">
        <Calculator className="h-4 w-4 text-cyan-400" /> Bahis Kontrol
        <span className="text-xs font-normal text-slate-400">— iddaa&apos;da gördüğünüz bahsi (faul, ofsayt, korner...) girin</span>
      </h3>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_140px]">
        <select
          value={fam.key}
          onChange={(e) => {
            const nf = families.find((f) => f.key === e.target.value);
            setFamKey(e.target.value);
            if (nf) setLine(Math.max(0.5, Math.round(nf.mean) - 0.5));
          }}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
        >
          {GROUPS.map((g) => {
            const fs = families.filter((f) => f.group === g);
            if (!fs.length) return null;
            return (
              <optgroup key={g} label={g}>
                {fs.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label} (beklenen {f.mean.toFixed(1)})
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <input
          type="number"
          step={1}
          min={0.5}
          value={line}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) setLine(Math.max(0.5, Math.floor(v) + 0.5));
          }}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
        />
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-700 bg-slate-950 p-1">
          {(["over", "under"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDir(d)}
              className={`rounded-md py-1 text-xs font-semibold ${dir === d ? "bg-cyan-500 text-slate-950" : "text-slate-300"}`}
            >
              {d === "over" ? "Üst" : "Alt"}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3">
        <PickCard pick={pick} />
      </div>
    </div>
  );
}

function FamilyTable({ fam }: { fam: CountFamily }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-bold text-white">{fam.label}</span>
        <span className="text-slate-400">
          Beklenen: <strong className="text-emerald-400">{fam.mean.toFixed(2)}</strong>
        </span>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-slate-500">
            <th className="text-left font-medium">Çizgi</th>
            <th className="text-right font-medium">Üst %</th>
            <th className="text-right font-medium">Alt %</th>
            <th className="text-right font-medium">Benzer maç (Üst)</th>
          </tr>
        </thead>
        <tbody>
          {fam.lines.map((l) => {
            const o = evaluateCountLine(fam, l, "over");
            return (
              <tr key={l} className="border-t border-slate-800/70">
                <td className="py-1 text-slate-300">{fmtLine(l)}</td>
                <td className={`text-right font-semibold ${o.probability >= 50 ? "text-emerald-400" : "text-slate-400"}`}>
                  {o.probability.toFixed(1)}
                </td>
                <td className={`text-right font-semibold ${o.probability < 50 ? "text-emerald-400" : "text-slate-400"}`}>
                  {(100 - o.probability).toFixed(1)}
                </td>
                <td className="text-right text-slate-400">{o.hitTotal ? `${o.hitCount}/${o.hitTotal}` : "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const SIM_COLS: Array<{ metric: Metric; label: string }> = [
  { metric: "fouls", label: "Faul" },
  { metric: "corners", label: "Korner" },
  { metric: "yellow", label: "Sarı" },
  { metric: "shots", label: "Şut" },
  { metric: "offsides", label: "Ofsayt" },
];

function SimilarTable({ teamName, oppName, rows }: { teamName: string; oppName: string; rows: SimilarMatch[] }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="mb-2 text-xs font-bold text-white">
        {teamName} — {oppName}&apos;a benzeyen rakiplere karşı
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-[11px]">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left font-medium">Rakip</th>
              <th className="text-right font-medium">Benzerlik</th>
              <th className="text-center font-medium">Skor</th>
              {SIM_COLS.map((c) => (
                <th key={c.metric} className="text-right font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.fixtureId} className="border-t border-slate-800/70">
                <td className="py-1.5 text-slate-200">
                  {r.isHome ? "(E)" : "(D)"} {r.opponent}
                  <div className="text-[10px] text-slate-500">
                    {r.competition} • {new Date(r.date).toLocaleDateString("tr-TR")}
                  </div>
                </td>
                <td className="text-right font-semibold text-cyan-400">%{r.similarity}</td>
                <td className="text-center font-bold text-white">{r.score}</td>
                {SIM_COLS.map((c) => {
                  const v = r.values[c.metric];
                  return (
                    <td key={c.metric} className="text-right text-slate-300">
                      {v?.for ?? "-"}
                      <span className="text-slate-600">/{v?.against ?? "-"}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10px] text-slate-500">Değerler: takımın kendisi / rakibi.</p>
    </div>
  );
}

function ProfileBars({ result }: { result: AnalysisResult }) {
  const keys = Object.keys(FEATURE_LABELS) as FeatureKey[];
  const { home, away } = result.profiles;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="mb-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="font-bold text-emerald-400">{result.home.name}</div>
          <div className="text-slate-400">{home.styleLabel}</div>
        </div>
        <div className="text-right">
          <div className="font-bold text-blue-400">{result.away.name}</div>
          <div className="text-slate-400">{away.styleLabel}</div>
        </div>
      </div>
      <div className="space-y-2">
        {keys.map((k) => {
          const h = home.percentiles[k];
          const a = away.percentiles[k];
          if (h === undefined && a === undefined) return null;
          return (
            <div key={k}>
              <div className="mb-0.5 flex justify-between text-[11px]">
                <span className="font-semibold text-emerald-400">{h ?? "-"}</span>
                <span className="text-slate-300">{FEATURE_LABELS[k]}</span>
                <span className="font-semibold text-blue-400">{a ?? "-"}</span>
              </div>
              <div className="flex h-1.5 gap-1">
                <div className="flex flex-1 justify-end overflow-hidden rounded-l-full bg-slate-800">
                  <div className="bg-emerald-500" style={{ width: `${h ?? 0}%` }} />
                </div>
                <div className="flex-1 overflow-hidden rounded-r-full bg-slate-800">
                  <div className="h-full bg-blue-500" style={{ width: `${a ?? 0}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-slate-500">Değerler 0-100 yüzdelik dilimdir (takip edilen tüm takımlara göre).</p>
    </div>
  );
}

function PlayersPanel({
  teamName,
  players,
  accent,
  onToggleMissing,
}: {
  teamName: string;
  players: PlayerImpactProfile[];
  accent: "emerald" | "blue";
  onToggleMissing: (playerId: number) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <span className={`text-xs font-bold ${accent === "emerald" ? "text-emerald-400" : "text-blue-400"}`}>
          {teamName} — Kilit Oyuncular
        </span>
        <span className="text-[10px] text-slate-500">Eksik/yedek olanı işaretleyin</span>
      </div>
      {players.length === 0 ? (
        <p className="text-xs text-slate-500">Bu takım için oyuncu istatistiği bulunamadı.</p>
      ) : (
        <div className="space-y-1.5">
          {players.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onToggleMissing(p.id)}
              className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                p.missing
                  ? "border-rose-500/60 bg-rose-500/10"
                  : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-400">
                    {p.position || "-"}
                  </span>
                  <span className={`truncate text-xs font-semibold ${p.missing ? "text-rose-300 line-through" : "text-white"}`}>
                    {p.name}
                  </span>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    p.missing ? "bg-rose-500/20 text-rose-300" : "bg-emerald-500/15 text-emerald-300"
                  }`}
                >
                  {p.missing ? "Eksik" : "Oynuyor"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-2.5 text-[10px] text-slate-400">
                <span>Faul yap: <strong className="text-slate-200">{p.foulsCommittedPg}</strong></span>
                <span>Faul al: <strong className="text-cyan-300">{p.foulsSufferedPg}</strong></span>
                <span>Şut: <strong className="text-slate-200">{p.shotsPg}</strong></span>
                <span>Sarı: <strong className="text-amber-300">{p.yellowPg}</strong></span>
              </div>
              {p.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {p.tags.map((t) => (
                    <span key={t} className="rounded bg-slate-800/90 px-1.5 py-0.5 text-[9px] text-slate-300">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Tab = "picks" | "markets" | "players" | "similar" | "style";

export default function AnalysisView({
  result,
  onToggleMissing,
}: {
  result: AnalysisResult;
  onToggleMissing: (playerId: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("picks");
  const [group, setGroup] = useState<MarketGroup>("Şut");
  const [periodFilter, setPeriodFilter] = useState<"both" | "ft" | "ht">("both");
  const ex = result.expected;

  const outcomesByGroup = useMemo(() => {
    const m = new Map<string, EvaluatedPick[]>();
    for (const o of result.outcomes) {
      const k = `${o.group}:${o.period}`;
      const arr = m.get(k) ?? [];
      arr.push(evaluateOutcome(o));
      m.set(k, arr);
    }
    return m;
  }, [result]);

  const statRow = (label: string, metric: Metric) =>
    ex[metric] ? (
      <div className="flex items-center justify-between rounded-lg bg-slate-950/60 px-3 py-1.5 text-xs">
        <span className="font-bold text-emerald-400">{ex[metric]!.home.toFixed(1)}</span>
        <span className="text-slate-400">{label}</span>
        <span className="font-bold text-blue-400">{ex[metric]!.away.toFixed(1)}</span>
      </div>
    ) : null;

  return (
    <div className="space-y-5">
      {/* Başlık */}
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span className="font-semibold text-emerald-400">
            {result.competition.name}
            {result.kickoff && ` • ${new Date(result.kickoff).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" })}`}
          </span>
          {result.referee && (
            <span className="rounded-full border border-slate-700 px-2.5 py-0.5">
              Hakem: {result.referee.name}
              {result.referee.matches >= 2 && ` • faul x${result.referee.foulsFactor} • kart x${result.referee.yellowFactor}`}
            </span>
          )}
        </div>
        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
          {[result.home, result.away].map((t, i) => (
            <div key={t.id} className={i === 1 ? "order-3" : ""}>
              {t.logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.logo} alt="" className="mx-auto h-12 w-12 object-contain" />
              )}
              <div className="mt-1 text-lg font-extrabold text-white">{t.name}</div>
              <div className="text-[11px] text-slate-400">
                {t.domesticLeague ?? "Avrupa"} • {t.wins}G {t.draws}B {t.losses}M
              </div>
              <div className="mt-1 flex justify-center gap-1">
                {t.form.map((f, idx) => (
                  <span
                    key={idx}
                    className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${
                      f === "G" ? "bg-emerald-500/20 text-emerald-400" : f === "B" ? "bg-amber-500/20 text-amber-400" : "bg-rose-500/20 text-rose-400"
                    }`}
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div className="order-2 flex flex-col items-center">
            <div className="text-[10px] uppercase tracking-widest text-slate-400">Beklenen gol</div>
            <div className="mt-1 rounded-2xl border border-emerald-500/40 bg-slate-950 px-4 py-2 text-2xl font-black text-white">
              {ex.goals?.home.toFixed(2)} - {ex.goals?.away.toFixed(2)}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              En olası skor: {result.topScores[0]?.home}-{result.topScores[0]?.away} (%{result.topScores[0]?.p})
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {statRow("İlk yarı beklenen gol", "htGoals")}
          {statRow("Beklenen faul", "fouls")}
          {statRow("Beklenen korner", "corners")}
          {statRow("Beklenen sarı kart", "yellow")}
          {statRow("Beklenen ofsayt", "offsides")}
          {statRow("Beklenen şut", "shots")}
          {statRow("Beklenen isabetli şut", "sot")}
        </div>

        {/* Taktiksel Reaksiyonlar (Özel Eşleşme Etkileri) */}
        {result.reactions.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
              <Zap className="h-3.5 w-3.5" /> Taktiksel Reaksiyon & Stil Çarpışması
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {result.reactions.map((rx) => (
                <div key={rx.id} className="rounded-xl border border-amber-500/25 bg-amber-950/15 p-3">
                  <div className="flex items-center justify-between text-xs font-bold text-white">
                    <span>{rx.title}</span>
                    <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                      x{rx.multiplier.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{rx.explanation}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {result.warnings.length > 0 && (
          <div className="mt-3 space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-200">
            {result.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" /> {w}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sekmeler */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-800 bg-slate-900/70 p-1.5">
        {(
          [
            { id: "picks", label: "En Güvenilir Tercihler", icon: ShieldCheck },
            { id: "markets", label: "Tüm Bahisler", icon: Target },
            {
              id: "players",
              label: `Kadro & Oyuncular${result.missingPlayerIds.length ? ` (${result.missingPlayerIds.length} eksik)` : ""}`,
              icon: UserMinus,
            },
            { id: "similar", label: "Benzer Rakipler", icon: Users },
            { id: "style", label: "Oyun Tarzı", icon: Calculator },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition ${
                tab === t.id ? "bg-emerald-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "picks" && (
        <div className="space-y-4">
          <BetChecker families={result.families} />
          <div>
            <h3 className="mb-2 text-sm font-bold text-white">Tüm pazarlar arasından en güvenilir seçimler</h3>
            <p className="mb-3 text-[11px] text-slate-400">
              Güven puanı; oyun tarzı benzerliği, taktiksel reaksiyonlar (ofsayt tuzağı, pres/faul baskısı), eksik oyuncular ve benzer maçlardaki gerçek tutma oranı birleştirilerek hesaplanır.
            </p>
            {result.topPicks.length === 0 ? (
              <p className="text-xs text-slate-500">Yeterli güvenilirlikte bahis bulunamadı.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {result.topPicks.map((p, i) => (
                  <PickCard key={p.key} pick={p} rank={i + 1} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "markets" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {GROUPS.map((g) => (
                <button
                  key={g}
                  onClick={() => setGroup(g)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    group === g ? "bg-cyan-500 text-slate-950" : "border border-slate-800 bg-slate-900 text-slate-300"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-[11px]">
              {(
                [
                  { id: "both", label: "MS + İY" },
                  { id: "ft", label: "Sadece MS" },
                  { id: "ht", label: "Sadece İY" },
                ] as const
              ).map((pf) => (
                <button
                  key={pf.id}
                  onClick={() => setPeriodFilter(pf.id)}
                  className={`rounded-md px-2.5 py-1 font-semibold transition ${
                    periodFilter === pf.id ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {pf.label}
                </button>
              ))}
            </div>
          </div>

          {(periodFilter === "both" || periodFilter === "ft") && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Maç Sonucu (MS) — {group}
              </div>
              {(outcomesByGroup.get(`${group}:ft`) ?? []).length > 0 && (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  {outcomesByGroup.get(`${group}:ft`)!.map((p) => (
                    <PickCard key={p.key} pick={p} />
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {result.families
                  .filter((f) => f.group === group && f.period === "ft")
                  .map((f) => (
                    <FamilyTable key={f.key} fam={f} />
                  ))}
              </div>
            </div>
          )}

          {(periodFilter === "both" || periodFilter === "ht") && (
            <div className="space-y-3 border-t border-slate-800/80 pt-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-400">
                <span className="h-2 w-2 rounded-full bg-cyan-400" />
                İlk Yarı (İY) — {group}
              </div>
              {(outcomesByGroup.get(`${group}:ht`) ?? []).length > 0 && (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  {outcomesByGroup.get(`${group}:ht`)!.map((p) => (
                    <PickCard key={p.key} pick={p} />
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {result.families
                  .filter((f) => f.group === group && f.period === "ht")
                  .map((f) => (
                    <FamilyTable key={f.key} fam={f} />
                  ))}
              </div>
            </div>
          )}

          {group === "Goller" && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="mb-2 text-xs font-bold text-white">En olası skorlar</div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {result.topScores.map((s) => (
                  <div key={`${s.home}-${s.away}`} className="rounded-lg border border-slate-800 p-2 text-center">
                    <div className="text-sm font-bold text-white">
                      {s.home}-{s.away}
                    </div>
                    <div className="text-[10px] text-emerald-400">%{s.p}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "players" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Maçta oynamayacak (sakat/cezalı/yedek) kilit oyuncuları işaretleyin; model o oyuncunun faul yapma, faul alma, şut ve kart payına göre tüm olasılıkları anında yeniden hesaplar.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <PlayersPanel
              teamName={result.home.name}
              players={result.players.home}
              accent="emerald"
              onToggleMissing={onToggleMissing}
            />
            <PlayersPanel
              teamName={result.away.name}
              players={result.players.away}
              accent="blue"
              onToggleMissing={onToggleMissing}
            />
          </div>
        </div>
      )}

      {tab === "similar" && (
        <div className="space-y-3">
          <SimilarTable teamName={result.home.name} oppName={result.away.name} rows={result.similar.home} />
          <SimilarTable teamName={result.away.name} oppName={result.home.name} rows={result.similar.away} />
        </div>
      )}

      {tab === "style" && <ProfileBars result={result} />}
    </div>
  );
}
