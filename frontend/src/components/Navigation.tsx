"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrendingUp, Play, RefreshCw, Layers, Settings as SettingsIcon, Activity, CheckCircle, AlertCircle, Database } from "lucide-react";

export default function Navigation() {
  const pathname = usePathname();
  const [triggeringCrawl, setTriggeringCrawl] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error"; title?: string } | null>(null);

  const showToast = (message: string, type: "success" | "error", title?: string) => {
    setToast({ message, type, title });
    setTimeout(() => {
      setToast(null);
    }, 6000);
  };

  React.useEffect(() => {
    const eventSource = new EventSource("/api/events");
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("[Global SSE Event]", data);
        
        if (data.type === "crawl_run_added") {
          const predCount = data.predictionsCreated || 0;
          const msg = predCount > 0 
            ? `Crawl complete. Analyzed ${data.matchesScraped || 0} matches and generated ${predCount} new predictions!` 
            : `Crawl complete. Analyzed ${data.matchesScraped || 0} matches. No new predictions met confidence limits.`;
          showToast(msg, "success", "Pipeline Finished");
        } else if (data.type === "match_settled") {
          const resMap: Record<string, string> = { "1": "Home Win", "2": "Away Win", "X": "Draw" };
          const outcome = resMap[data.result || ""] || "Completed";
          showToast(`Match settled: ${data.homeTeam} vs ${data.awayTeam} (${outcome})`, "success", "Match Settled");
        }
      } catch (err) {
        // Keep-alive or non-JSON
      }
    };
    
    return () => {
      eventSource.close();
    };
  }, []);

  const handleTriggerCrawl = async () => {
    setTriggeringCrawl(true);
    try {
      const res = await fetch("/api/trigger-crawl", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        showToast("Crawler and Prediction workers successfully queued in Redis!", "success");
        // Reload page if on dashboard/predictions to refresh stats
        if (pathname === "/" || pathname === "/predictions") {
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        }
      } else {
        showToast("Trigger failed: " + data.error, "error");
      }
    } catch (e: any) {
      showToast("Error triggering crawl: " + e.message, "error");
    } finally {
      setTriggeringCrawl(false);
    }
  };

  const navLinks = [
    { href: "/", label: "Dashboard", icon: Activity },
    { href: "/predictions", label: "Predictions", icon: Layers },
    { href: "/historical", label: "Stats", icon: Database },
    { href: "/settings", label: "Settings", icon: SettingsIcon },
  ];

  return (
    <>
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-10 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-indigo-200 via-slate-100 to-indigo-100 bg-clip-text text-transparent">
                BetSmart
              </h1>
              <p className="text-xs text-slate-400 font-medium">Double-Chance LLM Predictor & Parlay Automation</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex gap-1.5 bg-slate-950/40 p-1 rounded-xl border border-slate-800/80">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 select-none ${
                    isActive
                      ? "bg-indigo-600/10 border border-indigo-500/30 text-indigo-400"
                      : "border border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {link.label}
                </Link>
              );
            })}
          </nav>
          
          <div className="flex items-center">
            <button
              onClick={handleTriggerCrawl}
              disabled={triggeringCrawl}
              className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 active:scale-95 transition-all text-white font-medium text-sm py-2 px-4 rounded-xl shadow-lg shadow-indigo-500/10 cursor-pointer disabled:opacity-50"
            >
              {triggeringCrawl ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4 fill-white" />
              )}
              {triggeringCrawl ? "Crawling..." : "Run Now"}
            </button>
          </div>
        </div>
      </header>

      {/* Sub-Header Queue Engine Status */}
      <div className="bg-slate-950/50 border-b border-slate-900/60 py-1.5 px-6 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto flex justify-end">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Queue Engine: Online</span>
          </div>
        </div>
      </div>

      {/* Premium Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-4 px-5 py-4 rounded-2xl border backdrop-blur-md shadow-2xl transition-all duration-300 transform translate-y-0 scale-100 animate-in fade-in slide-in-from-bottom-5 ${
          toast.type === "success"
            ? "bg-slate-900/90 border-emerald-500/30 text-slate-200"
            : "bg-slate-900/90 border-rose-500/30 text-slate-200"
        }`}>
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${
            toast.type === "success" 
              ? "bg-emerald-500/10 text-emerald-400" 
              : "bg-rose-500/10 text-rose-400"
          }`}>
            {toast.type === "success" ? (
              <CheckCircle className="h-5 w-5" />
            ) : (
              <AlertCircle className="h-5 w-5" />
            )}
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-slate-100">
              {toast.title || (toast.type === "success" ? "Success" : "Error")}
            </div>
            <p className="text-xs text-slate-400 mt-0.5 max-w-[280px]">
              {toast.message}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
