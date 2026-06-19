"use client";

import React, { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import SettingsNavigation from "@/components/SettingsNavigation";

interface SystemSettings {
  seasonsToSync: string;
}

interface LeagueStatus {
  league: string;
  count: number;
  minDate: string;
  maxDate: string;
}

const AVAILABLE_SEASONS = [
  { code: "2526", label: "2025/2026" },
  { code: "2425", label: "2024/2025" },
  { code: "2324", label: "2023/2024" },
  { code: "2223", label: "2022/2023" },
  { code: "2122", label: "2021/2022" },
  { code: "2021", label: "2020/2021" },
  { code: "1920", label: "2019/2020" },
  { code: "1819", label: "2018/2019" },
  { code: "1718", label: "2017/2018" },
  { code: "1617", label: "2016/2017" },
  { code: "1516", label: "2015/2016" },
];

export default function DataSettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [dbStatus, setDbStatus] = useState<LeagueStatus[]>([]);
  const [loadingDbStatus, setLoadingDbStatus] = useState(true);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (res.ok) {
        setSettings(data);
      }
    } catch (e) {
      console.error("Failed to fetch settings:", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchDbStatus = async () => {
    setLoadingDbStatus(true);
    try {
      const res = await fetch("/api/ingest-status");
      const data = await res.json();
      if (res.ok && data.success) {
        setDbStatus(data.status);
      }
    } catch (e) {
      console.error("Failed to fetch ingestion status:", e);
    } finally {
      setLoadingDbStatus(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchDbStatus();
  }, []);

  const handleToggleSeason = async (seasonCode: string) => {
    if (!settings) return;
    const currentSeasons = settings.seasonsToSync
      ? settings.seasonsToSync.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    
    let newSeasons;
    if (currentSeasons.includes(seasonCode)) {
      newSeasons = currentSeasons.filter((s) => s !== seasonCode);
    } else {
      newSeasons = [...currentSeasons, seasonCode];
    }
    
    const updatedSettings = {
      ...settings,
      seasonsToSync: newSeasons.join(","),
    };
    
    setSettings(updatedSettings);

    // Save this dynamically to settings
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedSettings),
      });
    } catch (e) {
      console.error("Failed to auto-save selected seasons:", e);
    }
  };

  const handleSyncCSV = async () => {
    setSyncStatus("Syncing CSVs...");
    try {
      const selectedSeasons = settings?.seasonsToSync
        ? settings.seasonsToSync.split(",").map(s => s.trim()).filter(Boolean)
        : [];
      const res = await fetch("/api/ingest-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seasons: selectedSeasons }),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncStatus(`Sync Success: Loaded ${data.count} matches!`);
        fetchDbStatus();
      } else {
        setSyncStatus("Sync failed: " + data.error);
      }
    } catch (e: any) {
      setSyncStatus("Sync error: " + e.message);
    } finally {
      setTimeout(() => setSyncStatus(null), 5000);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-12">
        <div className="text-center">
          <RefreshCw className="mx-auto h-10 w-10 animate-spin text-indigo-500 mb-4" />
          <p className="text-sm text-slate-400 font-medium">Loading Data Sync Status...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-6 mt-8 w-full">
      <SettingsNavigation />

      {settings && (
        <div className="bg-slate-900/40 border border-slate-800/80 p-8 rounded-2xl shadow-xl backdrop-blur-sm space-y-6 max-w-4xl mx-auto mb-12 font-sans">
          <div>
            <h2 className="text-lg font-bold text-slate-200">Historical Data Sync Manager</h2>
            <p className="text-xs text-slate-400 mt-1">
              Configure which football seasons are stored locally and sync matches (goals, shots, corners, fouls) from football-data.co.uk.
            </p>
          </div>

          {/* Season Checkboxes */}
          <div className="space-y-2 pt-4 border-t border-slate-800">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Seasons to Ingest</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 bg-slate-950/40 p-4 rounded-xl border border-slate-800">
              {AVAILABLE_SEASONS.map((season) => {
                const isChecked = (settings.seasonsToSync || "")
                  .split(",")
                  .map((s) => s.trim())
                  .includes(season.code);
                return (
                  <label key={season.code} className="inline-flex items-center cursor-pointer select-none py-1.5 px-2 hover:bg-slate-850 rounded-md transition-all">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleSeason(season.code)}
                      className="rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-0 mr-2 h-4 w-4"
                    />
                    <span className="text-xs font-medium text-slate-300">{season.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Current DB Stats Status */}
          <div className="space-y-4 border-t border-slate-800 pt-6">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Local Database Status</label>
            
            {loadingDbStatus ? (
              <div className="text-xs text-slate-500 flex items-center gap-2 py-2">
                <RefreshCw className="h-4 w-4 animate-spin text-slate-450" />
                <span>Checking database...</span>
              </div>
            ) : dbStatus.length === 0 ? (
              <div className="text-xs text-slate-500 bg-slate-950/40 p-4 rounded-xl border border-slate-800">
                No historical matches ingested yet. Select seasons above and sync to begin.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-855 bg-slate-950/40">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/50 text-slate-400 font-semibold">
                      <th className="py-2.5 px-4">League</th>
                      <th className="py-2.5 px-4 text-center">Matches Ingested</th>
                      <th className="py-2.5 px-4 text-right">Date Range</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850/60">
                    {dbStatus.map((row) => (
                      <tr key={row.league} className="text-slate-300 hover:bg-slate-850/30">
                        <td className="py-2.5 px-4 font-semibold text-slate-200">{row.league}</td>
                        <td className="py-2.5 px-4 text-center font-mono">{row.count.toLocaleString()}</td>
                        <td className="py-2.5 px-4 text-right text-slate-400">
                          {row.minDate ? new Date(row.minDate).toLocaleDateString() : 'N/A'} - {row.maxDate ? new Date(row.maxDate).toLocaleDateString() : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-6 border-t border-slate-800">
            <button
              type="button"
              onClick={handleSyncCSV}
              disabled={syncStatus !== null}
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm py-2.5 px-6 rounded-xl transition-all cursor-pointer disabled:opacity-50"
            >
              {syncStatus && syncStatus.includes("Syncing") && (
                <RefreshCw className="h-4 w-4 animate-spin" />
              )}
              {syncStatus || "Ingest & Sync Data"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
