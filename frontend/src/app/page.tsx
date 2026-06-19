"use client";

import React, { useState, useEffect } from "react";
import { 
  Percent, 
  Flame, 
  DollarSign, 
  CheckCircle, 
  XCircle, 
  Wallet,
  RefreshCw
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts";

interface StatsSummary {
  totalBets: number;
  wins: number;
  losses: number;
  winRate: number;
  netProfit: number;
  roi: number;
}

interface BetSelection {
  id: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchTime: string;
  kickoffTime?: string;
  selection: string;
  odds: number;
  status?: string;
}

interface BetSlip {
  id: number;
  stake: number;
  totalOdds: number;
  status?: string;
  placedAt: string;
  profit?: number;
  selections: BetSelection[];
}

interface SystemSettings {
  accountBalance: number;
}

export default function Dashboard() {
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [pendingBets, setPendingBets] = useState<BetSlip[]>([]);
  const [pastBets, setPastBets] = useState<BetSlip[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveConnected, setLiveConnected] = useState(false);

  const fetchDashboardData = async () => {
    try {
      const res = await fetch("/api/dashboard");
      const data = await res.json();
      if (res.ok) {
        setSummary(data.summary);
        setChartData(data.chartData);
        setPendingBets(data.pendingBets || []);
        setPastBets(data.pastBets || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (res.ok) {
        setSettings(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const initData = async () => {
    setLoading(true);
    await Promise.all([fetchDashboardData(), fetchSettings()]);
    setLoading(false);
  };

  useEffect(() => {
    initData();

    // Setup Server-Sent Events listener
    const eventSource = new EventSource("/api/events");
    
    eventSource.onopen = () => {
      setLiveConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("[SSE Event Received]", data);
        fetchDashboardData();
        fetchSettings();
      } catch (err) {
        // Handle keep-alive pings or non-JSON
      }
    };

    eventSource.onerror = () => {
      setLiveConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-12">
        <div className="text-center">
          <RefreshCw className="mx-auto h-10 w-10 animate-spin text-indigo-500 mb-4" />
          <p className="text-sm text-slate-400 font-medium">Loading Dashboard Data...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-6 mt-8 w-full">
      {/* KPI Grid */}
      <section className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-8">
        <div className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl backdrop-blur-sm shadow-xl flex flex-col justify-between">
          <div className="flex justify-between items-center w-full">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Account Balance</span>
            {liveConnected && (
              <span className="flex items-center gap-1 text-[9px] text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded select-none">
                <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse"></span> LIVE
              </span>
            )}
          </div>
          <div className="flex justify-between items-baseline mt-4">
            <span className="text-2xl font-extrabold text-indigo-400">
              ₦{settings?.accountBalance?.toLocaleString() || "0"}
            </span>
            <Wallet className="h-5 w-5 text-indigo-400" />
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl backdrop-blur-sm shadow-xl flex flex-col justify-between">
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Total Slips</span>
          <div className="flex justify-between items-baseline mt-4">
            <span className="text-3xl font-extrabold text-slate-100">{summary?.totalBets || 0}</span>
            <span className="text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded text-xs font-semibold">Parlays</span>
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl backdrop-blur-sm shadow-xl flex flex-col justify-between">
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Win / Loss</span>
          <div className="flex justify-between items-baseline mt-4">
            <span className="text-2xl font-bold text-slate-100">
              <span className="text-emerald-400">{summary?.wins || 0}W</span>
              <span className="text-slate-500 mx-1">/</span>
              <span className="text-rose-400">{summary?.losses || 0}L</span>
            </span>
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl backdrop-blur-sm shadow-xl flex flex-col justify-between">
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Win Rate</span>
          <div className="flex justify-between items-baseline mt-4">
            <span className="text-3xl font-extrabold text-slate-100">{summary?.winRate || 0}%</span>
            <Percent className="h-5 w-5 text-indigo-400" />
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl backdrop-blur-sm shadow-xl flex flex-col justify-between">
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Net Profit</span>
          <div className="flex justify-between items-baseline mt-4">
            <span className={`text-2xl font-extrabold ${summary && summary.netProfit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              ₦{summary?.netProfit?.toLocaleString() || "0"}
            </span>
            <DollarSign className={`h-5 w-5 ${summary && summary.netProfit >= 0 ? "text-emerald-400" : "text-rose-400"}`} />
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl backdrop-blur-sm shadow-xl flex flex-col justify-between">
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">ROI</span>
          <div className="flex justify-between items-baseline mt-4">
            <span className={`text-3xl font-extrabold ${summary && summary.roi >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {summary?.roi || 0}%
            </span>
            <Flame className={`h-5 w-5 ${summary && summary.roi >= 0 ? "text-amber-500" : "text-rose-400"}`} />
          </div>
        </div>
      </section>

      <div className="space-y-8 mb-12">
        {/* Chart */}
        <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl shadow-xl backdrop-blur-sm">
          <h2 className="text-lg font-bold text-slate-200 mb-4">Cumulative Profit Timeline (₦)</h2>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height={288}>
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" stroke="#64748b" fontSize={12} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={12} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", color: "#f1f5f9" }}
                />
                <Area
                  type="monotone"
                  dataKey="profit"
                  stroke="#6366f1"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#profitGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Active Pending Parlays */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-slate-200">Active / Pending Accumulator Slips</h2>
          {pendingBets.length === 0 ? (
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 text-center text-slate-500 font-medium">
              No active pending parlays. Trigger a crawl to scan games.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {pendingBets.map((slip) => (
                <div key={slip.id} className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-sm space-y-4">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                    <div>
                      <span className="text-xs text-indigo-400 font-bold">SLIP #{slip.id}</span>
                      <div className="text-[10px] text-slate-500 mt-0.5">{new Date(slip.placedAt).toLocaleString()}</div>
                    </div>
                    <span className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-500/10 text-amber-400">
                      Pending Matches
                    </span>
                  </div>
                  
                  <div className="space-y-3">
                    {slip.selections.map((sel) => (
                      <div key={sel.id} className="flex justify-between items-center text-sm border-l-2 pl-2 border-slate-800">
                        <div>
                          <div className="font-semibold text-slate-200">{sel.homeTeam} vs {sel.awayTeam}</div>
                          <div className="text-[10px] text-slate-500">
                            {sel.league} {sel.kickoffTime ? `· KO: ${new Date(sel.kickoffTime).toLocaleString()}` : ""}
                          </div>
                        </div>
                        <div className="text-right flex items-center gap-2">
                          <span className="font-mono font-bold text-indigo-400 bg-indigo-500/5 px-2 py-0.5 rounded text-xs">
                            {sel.selection}
                          </span>
                          <span className="text-xs text-slate-400">@{sel.odds}</span>
                          {sel.status && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                              sel.status === "won" 
                                ? "bg-emerald-500/10 text-emerald-400" 
                                : sel.status === "lost" 
                                ? "bg-rose-500/10 text-rose-400" 
                                : "bg-amber-500/10 text-amber-400"
                            }`}>
                              {sel.status}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-slate-800 pt-3 flex justify-between items-center text-xs text-slate-400 font-medium">
                    <div>Combined Odds: <span className="font-bold text-slate-200">{slip.totalOdds}x</span></div>
                    <div>Stake: <span className="font-bold text-slate-200">₦{slip.stake.toLocaleString()}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Settled Parlays History */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-slate-200">Settled Accumulator Slips History</h2>
          {pastBets.length === 0 ? (
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 text-center text-slate-500 font-medium">
              No settled parlays recorded.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {pastBets.map((slip) => (
                <div key={slip.id} className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-sm space-y-4">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                    <div>
                      <span className="text-xs text-indigo-400 font-bold">SLIP #{slip.id}</span>
                      <div className="text-[10px] text-slate-500 mt-0.5">{new Date(slip.placedAt).toLocaleString()}</div>
                    </div>
                    {slip.status === "won" ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-emerald-500/10 text-emerald-400">
                        <CheckCircle className="h-3.5 w-3.5" /> Won
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-rose-500/10 text-rose-400">
                        <XCircle className="h-3.5 w-3.5" /> Lost
                      </span>
                    )}
                  </div>

                  <div className="space-y-3">
                    {slip.selections.map((sel) => (
                      <div key={sel.id} className="flex justify-between items-center text-sm border-l-2 pl-2 border-slate-850">
                        <div>
                          <div className="font-semibold text-slate-200">{sel.homeTeam} vs {sel.awayTeam}</div>
                          <div className="text-[10px] text-slate-500">
                            {sel.league} {sel.kickoffTime ? `· KO: ${new Date(sel.kickoffTime).toLocaleString()}` : ""}
                          </div>
                        </div>
                        <div className="text-right flex items-center gap-2">
                          <span className="font-mono font-bold text-indigo-400 bg-indigo-500/5 px-2 py-0.5 rounded text-xs">
                            {sel.selection}
                          </span>
                          <span className="text-xs text-slate-400">@{sel.odds}</span>
                          {sel.status && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                              sel.status === "won" 
                                ? "bg-emerald-500/10 text-emerald-400" 
                                : sel.status === "lost" 
                                ? "bg-rose-500/10 text-rose-400" 
                                : "bg-amber-500/10 text-amber-400"
                            }`}>
                              {sel.status}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-slate-800 pt-3 flex justify-between items-center text-xs">
                    <div className="text-slate-400">Combined Odds: <span className="font-bold text-slate-200">{slip.totalOdds}x</span></div>
                    <div className="text-slate-400">Stake: <span className="font-bold text-slate-200">₦{slip.stake.toLocaleString()}</span></div>
                    <div className={`font-bold ${slip.status === "won" ? "text-emerald-400" : "text-rose-400"}`}>
                      {slip.status === "won" ? "+" : "-"}₦{Math.abs(slip.profit || 0).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
