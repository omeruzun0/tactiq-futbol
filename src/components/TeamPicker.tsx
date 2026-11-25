"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

export interface TeamOption {
  id: number;
  name: string;
  logo?: string;
  league: string;
  played: number;
}

function norm(s: string) {
  return s
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
}

export default function TeamPicker({
  label,
  teams,
  value,
  onChange,
}: {
  label: string;
  teams: TeamOption[];
  value: TeamOption | null;
  onChange: (t: TeamOption | null) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const list = useMemo(() => {
    const nq = norm(q.trim());
    return (nq ? teams.filter((t) => norm(t.name).includes(nq)) : teams).slice(0, 40);
  }, [q, teams]);

  return (
    <div ref={ref} className="relative">
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</label>
      <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 focus-within:border-emerald-500">
        <Search className="h-4 w-4 text-slate-500" />
        <input
          value={open ? q : value?.name ?? q}
          onFocus={() => {
            setOpen(true);
            setQ("");
          }}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          placeholder="Takım ara (ör. Inter)"
          className="w-full bg-transparent text-sm text-white placeholder-slate-500 outline-none"
        />
      </div>
      {open && (
        <div className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
          {list.length === 0 ? (
            <div className="p-3 text-xs text-slate-500">Takım bulunamadı.</div>
          ) : (
            list.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  onChange(t);
                  setOpen(false);
                  setQ("");
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-800"
              >
                {t.logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.logo} alt="" className="h-5 w-5 object-contain" />
                )}
                <span className="flex-1 text-white">{t.name}</span>
                <span className="text-[10px] text-slate-500">
                  {t.league} • {t.played} maç
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
