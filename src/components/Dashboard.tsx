"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnalysisResult } from "@/lib/football/types";
import AnalysisView from "./AnalysisView";
import SettingsModal, { StatusData } from "./SettingsModal";
import TeamPicker, { TeamOption } from "./TeamPicker";
import { CalendarDays, Cpu, Loader2, Search, Settings } from "lucide-react";

interface FixtureItem {
  id: number;
  leagueId: number;
  leagueName: string;
  date: string;
  status: string;
  referee: string | null;
  home: { id: number; name: string; logo?: string };
  away: { id: number; name: string; logo?: string };
}

export default function Dashboard() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [fixtures, setFixtures] = useState<FixtureItem[]>([]);
  const [days, setDays] = useState(3);
  const [homeTeam, setHomeTeam] = useState<TeamOption | null>(null);
  const [awayTeam, setAwayTeam] = useState<TeamOption | null>(null);
  const [selectedFixture, setSelectedFixture] = useState<number | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadStatus = useCallback(async () => {
    const r = await fetch("/api/status");
    const s = (await r.json()) as StatusData;
    setStatus(s);
    return s;
  }, []);

  const loadCatalog = useCallback(async () => {
    const r = await fetch(`/api/catalog?days=${days}`);
    const d = await r.json();
    setTeams(d.teams ?? []);
    setFixtures(d.fixtures ?? []);
  }, [days]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const running = status?.sync.running;
  useEffect(() => {
    const t = setInterval(async () => {
      await loadStatus();
      loadCatalog();
    }, running ? 2500 : 60000);
    return () => clearInterval(t);
  }, [running, loadStatus, loadCatalog]);

  const [activeQuery, setActiveQuery] = useState<{ homeId: number; awayId: number; fixtureId?: number } | null>(null);

  const analyze = async (homeId: number, awayId: number, fixtureId?: number, missingIds: number[] = []) => {
    setActiveQuery({ homeId, awayId, fixtureId });
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ home: String(homeId), away: String(awayId) });
      if (fixtureId) qs.set("fixture", String(fixtureId));
      if (missingIds.length) qs.set("missing", missingIds.join(","));
      const r = await fetch(`/api/analyze?${qs}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Analiz yapılamadı");
      setResult(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleMissing = (playerId: number) => {
    if (!activeQuery || !result) return;
    const cur = new Set(result.missingPlayerIds || []);
    if (cur.has(playerId)) cur.delete(playerId);
    else cur.add(playerId);
    analyze(activeQuery.homeId, activeQuery.awayId, activeQuery.fixtureId, [...cur]);
  };

  const grouped = useMemo(() => {
    const m = new Map<string, FixtureItem[]>();
    for (const f of fixtures) {
      const day = new Date(f.date).toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });
      const arr = m.get(day) ?? [];
      arr.push(f);
      m.set(day, arr);
    }
    return [...m.entries()];
  }, [fixtures]);

  const noData = status && status.totals.finished === 0;
  const syncPct =
    status?.sync.total && status.sync.total > 0
      ? Math.round((status.sync.done / status.sync.total) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#070b14]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-slate-950">
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-extrabold tracking-tight text-white">TactIQ Futbol</h1>
              <p className="text-xs text-slate-400">Oyun tarzı benzerliğine göre bahis güvenilirlik analizi</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status && (
              <span className="hidden items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300 sm:inline-flex">
                {running ? (
                  <Loader2 className="h-3 w-3 animate-spin text-emerald-400" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                )}
                {running
                  ? `${status.sync.message} (%${syncPct})`
                  : `${status.totals.withStats} maç istatistiği (${status.season}/${status.season + 1})`}
              </span>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400"
            >
              <Settings className="h-3.5 w-3.5" /> Veri Ayarları
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5">
        {running && status && (
          <div className="mb-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <div className="flex items-center justify-between text-xs text-emerald-200">
              <span className="flex items-center gap-2 font-semibold">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                {status.sync.message}
              </span>
              <span>%{syncPct}</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div className="h-full bg-emerald-400 transition-all" style={{ width: `${syncPct}%` }} />
            </div>
          </div>
        )}
        {status?.sync.error && (
          <div className="mb-5 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{status.sync.error}</div>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <aside className="space-y-4 lg:col-span-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                <Search className="h-4 w-4 text-emerald-400" /> Maç Sorgula
              </h2>
              <div className="space-y-3">
                <TeamPicker label="Ev sahibi" teams={teams} value={homeTeam} onChange={setHomeTeam} />
                <TeamPicker label="Deplasman" teams={teams} value={awayTeam} onChange={setAwayTeam} />
                <button
                  disabled={!homeTeam || !awayTeam || homeTeam.id === awayTeam.id || loading}
                  onClick={() => {
                    setSelectedFixture(null);
                    analyze(homeTeam!.id, awayTeam!.id);
                  }}
                  className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
                >
                  Analiz Et
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold text-white">
                  <CalendarDays className="h-4 w-4 text-emerald-400" /> Bülten
                </h2>
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300"
                >
                  <option value={1}>Bugün</option>
                  <option value={3}>3 gün</option>
                  <option value={7}>7 gün</option>
                </select>
              </div>
              {fixtures.length === 0 ? (
                <p className="text-xs text-slate-500">
                  {noData ? "2026-27 sezonu verileri indiriliyor, birkaç saniye içinde bülten dolacak..." : "Bu aralıkta maç yok."}
                </p>
              ) : (
                <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                  {grouped.map(([day, list]) => (
                    <div key={day}>
                      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{day}</div>
                      <div className="space-y-1.5">
                        {list.map((f) => (
                          <button
                            key={f.id}
                            onClick={() => {
                              setSelectedFixture(f.id);
                              analyze(f.home.id, f.away.id, f.id);
                            }}
                            className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                              selectedFixture === f.id
                                ? "border-emerald-500/70 bg-slate-900"
                                : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                            }`}
                          >
                            <div className="flex justify-between text-[10px] text-slate-500">
                              <span className="text-emerald-400/80">{f.leagueName}</span>
                              <span>{new Date(f.date).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                            <div className="mt-0.5 text-sm font-semibold text-white">
                              {f.home.name} <span className="text-slate-500">-</span> {f.away.name}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <section className="lg:col-span-8">
            {loading ? (
              <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/50 text-slate-400">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Analiz ediliyor...
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-200">{error}</div>
            ) : result ? (
              <AnalysisView result={result} onToggleMissing={handleToggleMissing} />
            ) : (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-10 text-center text-sm text-slate-400">
                Bültenden bir maç seçin ya da iki takım yazıp <strong className="text-white">Analiz Et</strong>&apos;e basın.
                <p className="mt-2 text-xs text-slate-500">
                  Uygulama her takımın bu sezon rakibine benzeyen takımlara karşı yaptığı faul, korner, kart, şut ve gol sayılarına bakar
                  ve tüm bahis seçenekleri arasından en güvenilirini sıralar.
                </p>
              </div>
            )}
          </section>
        </div>
      </main>

      <SettingsModal
        open={settingsOpen}
        status={status}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => {
          loadStatus();
          setTimeout(loadCatalog, 3000);
        }}
      />
    </div>
  );
}
