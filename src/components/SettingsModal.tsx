"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle2, Database, KeyRound, RefreshCw, X } from "lucide-react";

export interface StatusData {
  source: "espn" | "apifootball";
  hasKey: boolean;
  keyPreview: string | null;
  season: number;
  leagues: Array<{ id: number; name: string; enabled: boolean; finished: number; withStats: number }>;
  totals: { fixtures: number; finished: number; withStats: number };
  lastListSync: string | null;
  lastStatsSync: string | null;
  sync: {
    running: boolean;
    phase: string;
    message: string;
    done: number;
    total: number;
    dailyRemaining?: number;
    error?: string;
  };
}

export default function SettingsModal({
  open,
  status,
  onClose,
  onSaved,
}: {
  open: boolean;
  status: StatusData | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [source, setSource] = useState<"espn" | "apifootball">("espn");
  const [apiKey, setApiKey] = useState("");
  const [leagues, setLeagues] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && status) {
      setSource(status.source ?? "espn");
      setLeagues(status.leagues.filter((l) => l.enabled).map((l) => l.id));
    }
  }, [open, status]);

  if (!open) return null;

  const save = async (action: "save" | "sync") => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "sync"
            ? { action }
            : { action, source, apiKey: apiKey || undefined, leagues }
        ),
      });
      setApiKey("");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const s = status?.sync;
  const pct = s && s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-emerald-400" />
            <h3 className="text-base font-bold text-white">Veri Kaynağı & Lig Ayarları</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setSource("espn")}
              className={`rounded-xl border p-3.5 text-left transition ${
                source === "espn"
                  ? "border-emerald-500 bg-emerald-500/10"
                  : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white">ESPN Futbol (Ücretsiz)</span>
                {source === "espn" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                Anahtar gerektirmez. 2026-27 güncel sezon faul, korner, kart, şut, topa sahip olma ve pas istatistikleri.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setSource("apifootball")}
              className={`rounded-xl border p-3.5 text-left transition ${
                source === "apifootball"
                  ? "border-emerald-500 bg-emerald-500/10"
                  : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white">API-Football (Pro Plan)</span>
                {source === "apifootball" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                Ücretli Pro anahtarınız varsa hakem verisi dahil alternatif kaynak olarak kullanabilirsiniz.
              </p>
            </button>
          </div>

          {source === "apifootball" && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <KeyRound className="h-3.5 w-3.5 text-emerald-400" /> API-Football Anahtarı
                {status?.keyPreview && (
                  <span className="ml-auto font-mono text-[11px] text-emerald-400">Kayıtlı: {status.keyPreview}</span>
                )}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Pro API-Football anahtarınızı yapıştırın"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          )}

          <div>
            <div className="mb-2 text-xs font-semibold text-slate-300">
              Takip edilecek ligler (sezon {status?.season}/{(status?.season ?? 0) + 1})
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {status?.leagues.map((l) => {
                const on = leagues.includes(l.id);
                return (
                  <label
                    key={l.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                      on ? "border-emerald-500/50 bg-emerald-500/10" : "border-slate-800 bg-slate-900/50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setLeagues((p) => (on ? p.filter((x) => x !== l.id) : [...p, l.id]))}
                      className="accent-emerald-500"
                    />
                    <span className="flex-1 font-medium text-white">{l.name}</span>
                    <span className="text-slate-400">
                      {l.withStats}/{l.finished} maç
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {s && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">Senkronizasyon</span>
                {s.dailyRemaining !== undefined && (
                  <span className="text-slate-400">Kalan günlük istek: {s.dailyRemaining}</span>
                )}
              </div>
              <p className="mt-1 text-slate-400">{s.message}</p>
              {s.running && (
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
              )}
              {s.error && <p className="mt-2 text-rose-400">{s.error}</p>}
              <p className="mt-2 text-slate-500">
                Toplam: {status?.totals.withStats}/{status?.totals.finished} oynanmış maçın detaylı istatistiği indirildi.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => save("sync")}
              disabled={saving || s?.running}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Şimdi Güncelle
            </button>
            <button
              onClick={() => save("save")}
              disabled={saving}
              className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              Kaydet ve Verileri İndir
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
