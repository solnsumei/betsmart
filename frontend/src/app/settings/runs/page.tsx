"use client";

import React, { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import SettingsNavigation from "@/components/SettingsNavigation";

export default function RunsSettingsPage() {
  // Crawl history states
  const [crawlHistory, setCrawlHistory] = useState<any[]>([]);
  const [loadingCrawlHistory, setLoadingCrawlHistory] = useState(true);

  // Crawl targets states
  const [targets, setTargets] = useState<{ id?: number; name: string; url: string; enabled: boolean }[]>([]);
  const [newTargetName, setNewTargetName] = useState("");
  const [newTargetUrl, setNewTargetUrl] = useState("");
  const [loadingTargets, setLoadingTargets] = useState(true);
  const [targetStatus, setTargetStatus] = useState<string | null>(null);
  const [targetToDelete, setTargetToDelete] = useState<number | null>(null);

  const fetchCrawlHistory = async () => {
    setLoadingCrawlHistory(true);
    try {
      const res = await fetch("/api/crawl-runs");
      const data = await res.json();
      if (res.ok && data.success) {
        setCrawlHistory(data.runs || []);
      }
    } catch (e) {
      console.error("Failed to fetch crawl history:", e);
    } finally {
      setLoadingCrawlHistory(false);
    }
  };

  const fetchTargets = async () => {
    setLoadingTargets(true);
    try {
      const res = await fetch("/api/crawl-targets");
      const data = await res.json();
      if (res.ok && data.success) {
        setTargets(data.targets || []);
      }
    } catch (e) {
      console.error("Failed to fetch crawl targets:", e);
    } finally {
      setLoadingTargets(false);
    }
  };

  const handleAddTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTargetName.trim() || !newTargetUrl.trim()) return;
    setTargetStatus("Adding...");
    try {
      const res = await fetch("/api/crawl-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTargetName, url: newTargetUrl }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTargetStatus("Target added!");
        setNewTargetName("");
        setNewTargetUrl("");
        fetchTargets();
      } else {
        setTargetStatus("Failed: " + data.error);
      }
    } catch (e: any) {
      setTargetStatus("Error: " + e.message);
    } finally {
      setTimeout(() => setTargetStatus(null), 3000);
    }
  };

  const handleToggleTarget = async (id: number, enabled: boolean) => {
    try {
      const res = await fetch("/api/crawl-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled }),
      });
      if (res.ok) {
        setTargets((prev) => prev.map((t) => (t.id === id ? { ...t, enabled } : t)));
      }
    } catch (e) {
      console.error("Failed to toggle target status:", e);
    }
  };

  const handleDeleteTarget = (id: number) => {
    setTargetToDelete(id);
  };

  const confirmDeleteTarget = async () => {
    if (targetToDelete === null) return;
    try {
      const res = await fetch(`/api/crawl-targets?id=${targetToDelete}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setTargets((prev) => prev.filter((t) => t.id !== targetToDelete));
      }
    } catch (e) {
      console.error("Failed to delete target:", e);
    } finally {
      setTargetToDelete(null);
    }
  };

  useEffect(() => {
    fetchTargets();
    fetchCrawlHistory();

    const eventSource = new EventSource("/api/events");
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "crawl_run_added") {
          fetchCrawlHistory();
        }
      } catch (err) {
        // Ignore parsing/keep-alive errors
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  return (
    <main className="max-w-7xl mx-auto px-6 mt-8 w-full">
      <SettingsNavigation />

      <div className="max-w-4xl mx-auto space-y-8 mb-12">
        {/* Web Crawler Targets (Table and Form) */}
        <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl shadow-xl backdrop-blur-sm space-y-6">
          <div>
            <h4 className="text-sm font-bold text-slate-200">Web Crawler Targets</h4>
            <p className="text-xs text-slate-400 mt-1">
              Manage the direct page URLs sequentially scraped by Playwright (e.g. Bet9ja league links, live pre-match odds).
            </p>
          </div>

          {/* Targets List */}
          {loadingTargets ? (
            <div className="text-xs text-slate-500 flex items-center gap-2 py-2">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-400" />
              <span>Loading crawl targets...</span>
            </div>
          ) : targets.length === 0 ? (
            <div className="text-xs text-slate-500 bg-slate-950/40 p-4 rounded-xl border border-slate-800">
              No custom crawl targets configured. Seeded with default odds scraper URL on execute.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/50 text-slate-400 font-semibold">
                    <th className="py-2.5 px-4">Label</th>
                    <th className="py-2.5 px-4">Target URL</th>
                    <th className="py-2.5 px-4 text-center">Status</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850/60">
                  {targets.map((target) => (
                    <tr key={target.id} className="text-slate-300 hover:bg-slate-850/30">
                      <td className="py-2.5 px-4 font-semibold text-slate-200">{target.name}</td>
                      <td className="py-2.5 px-4 truncate max-w-[220px] font-mono text-slate-400" title={target.url}>
                        {target.url}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <label className="inline-flex items-center cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={target.enabled}
                            onChange={(e) => handleToggleTarget(target.id!, e.target.checked)}
                            className="rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-0 mr-1.5 h-3.5 w-3.5"
                          />
                          <span className="text-[10px] font-semibold text-slate-400">
                            {target.enabled ? "Active" : "Inactive"}
                          </span>
                        </label>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteTarget(target.id!)}
                          className="text-[10px] font-bold text-rose-400 hover:text-rose-300 transition-all cursor-pointer"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Add New Target Form */}
          <div className="border-t border-slate-800/80 pt-6 space-y-3">
            <h5 className="text-xs font-bold text-slate-450 uppercase tracking-wider">Add New Crawl Page</h5>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                placeholder="e.g. Bet9ja Premier League"
                value={newTargetName}
                onChange={(e) => setNewTargetName(e.target.value)}
                className="flex-1 bg-slate-950/60 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                placeholder="https://sports.bet9ja.com/sport/football/england/premier-league"
                value={newTargetUrl}
                onChange={(e) => setNewTargetUrl(e.target.value)}
                className="flex-[2] bg-slate-950/60 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={handleAddTarget}
                disabled={!newTargetName.trim() || !newTargetUrl.trim()}
                className="bg-slate-800 hover:bg-slate-750 text-indigo-400 border border-slate-700 font-bold text-xs py-2.5 px-5 rounded-xl transition-all cursor-pointer disabled:opacity-50"
              >
                {targetStatus || "Add Target"}
              </button>
            </div>
          </div>
        </div>

        {/* Crawl Execution History */}
        <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl shadow-xl backdrop-blur-sm space-y-6">
          <div>
            <h4 className="text-sm font-bold text-slate-200">Crawl Execution Logs</h4>
            <p className="text-xs text-slate-400 mt-1">
              Historical logs of automatic and manual crawling executions, run durations, and predictions generated.
            </p>
          </div>

          {loadingCrawlHistory ? (
            <div className="text-xs text-slate-500 flex items-center gap-2 py-2">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-400" />
              <span>Loading crawl runs...</span>
            </div>
          ) : crawlHistory.length === 0 ? (
            <div className="text-xs text-slate-500 bg-slate-950/40 p-4 rounded-xl border border-slate-800">
              No crawl runs recorded yet. Run a crawl to start logging metrics.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/50 text-slate-400 font-semibold">
                    <th className="py-2.5 px-4">Run Time</th>
                    <th className="py-2.5 px-4 text-center">Status</th>
                    <th className="py-2.5 px-4 text-center">Duration</th>
                    <th className="py-2.5 px-4 text-center">Scraped</th>
                    <th className="py-2.5 px-4 text-center">Predictions</th>
                    <th className="py-2.5 px-4 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850/60">
                  {crawlHistory.map((run) => (
                    <tr key={run.id} className="text-slate-300 hover:bg-slate-850/30">
                      <td className="py-2.5 px-4 font-medium text-slate-200">
                        {new Date(run.startedAt).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          run.status === "success" 
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                            : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                        }`}>
                          {run.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-center font-mono text-slate-400">
                        {run.durationSeconds}s
                      </td>
                      <td className="py-2.5 px-4 text-center font-mono font-semibold text-slate-300">
                        {run.runMetadata?.matchesScraped || 0}
                      </td>
                      <td className="py-2.5 px-4 text-center font-mono font-semibold text-indigo-400">
                        {run.runMetadata?.predictionsCreated || 0}
                      </td>
                      <td className="py-2.5 px-4 text-right text-slate-500 truncate max-w-[200px]" title={run.runMetadata?.errorMessage || run.runMetadata?.targetsCrawled?.join(", ")}>
                        {run.runMetadata?.errorMessage ? (
                          <span className="text-rose-400 font-medium">{run.runMetadata.errorMessage}</span>
                        ) : (
                          <span>{run.runMetadata?.targetsCrawled?.length || 0} Targets</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Custom Modal Confirmation */}
      {targetToDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <h3 className="text-base font-bold text-slate-200">Delete Crawl Target?</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Are you sure you want to delete this crawl target? This action will remove the target page from the list of URLs scanned by the web crawler.
            </p>
            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setTargetToDelete(null)}
                className="px-4 py-2 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-950/40 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteTarget}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-xs font-bold transition-all cursor-pointer shadow-lg shadow-rose-500/10"
              >
                Delete Target
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
