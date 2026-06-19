"use client";

import React, { useState, useEffect } from "react";
import { RefreshCw, Check, Ticket, Trash2, X, Wallet, CheckCircle, ChevronLeft, ChevronRight } from "lucide-react";

interface Prediction {
  id: number;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchTime: string;
  predictedOutcome: string;
  confidence: number;
  reasoning: string;
  odds1X: number | null;
  odds12: number | null;
  oddsX2: number | null;
  predictedAt: string;
  status: string;
  hasBet: boolean;
  result: string | null;
  doubleChanceResult: string | null;
}

interface SystemSettings {
  accountBalance: number;
  stake: number;
  targetAccuracy: number;
}

export default function PredictionsPage() {
  const [predictionsList, setPredictionsList] = useState<Prediction[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [liveConnected, setLiveConnected] = useState(false);
  
  // Selection state for manual bet slip
  const [selectedPredictions, setSelectedPredictions] = useState<Prediction[]>([]);
  const [customStake, setCustomStake] = useState<number>(1000);
  const [placingBet, setPlacingBet] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placeSuccess, setPlaceSuccess] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeTab, setActiveTab] = useState<"unplaced" | "placed_unsettled" | "placed_settled">("unplaced");
  const [searchQuery, setSearchQuery] = useState("");
  const itemsPerPage = 10;

  // Reset page to 1 when tab or search query changes
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery]);

  const fetchData = async () => {
    try {
      const [predRes, setRes] = await Promise.all([
        fetch("/api/dashboard"),
        fetch("/api/settings")
      ]);
      const predData = await predRes.json();
      const setData = await setRes.json();
      
      if (predRes.ok) {
        const parsedPredictions = (predData.predictions || []).map((p: any) => ({
          ...p,
          odds1X: p.odds1X ? parseFloat(p.odds1X) : null,
          odds12: p.odds12 ? parseFloat(p.odds12) : null,
          oddsX2: p.oddsX2 ? parseFloat(p.oddsX2) : null,
        }));
        setPredictionsList(parsedPredictions);
        setSummary(predData.summary || null);
      }
      if (setRes.ok) {
        const parsedSettings = {
          ...setData,
          accountBalance: parseFloat(setData.accountBalance) || 0,
          stake: parseFloat(setData.stake) || 0,
        };
        setSettings(parsedSettings);
        if (setData.stake) {
          setCustomStake(parseFloat(setData.stake) || 1000);
        }
      }
    } catch (e) {
      console.error("Failed to fetch data:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Setup Server-Sent Events listener
    const eventSource = new EventSource("/api/events");
    
    eventSource.onopen = () => {
      setLiveConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("[SSE Event Received in Predictions]", data);
        fetchData();
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

  const getSelectionOdds = (pred: Prediction): number => {
    if (pred.predictedOutcome === "1X") return pred.odds1X || 1.0;
    if (pred.predictedOutcome === "12") return pred.odds12 || 1.0;
    if (pred.predictedOutcome === "X2") return pred.oddsX2 || 1.0;
    return 1.0;
  };

  const formatRelativeTime = (matchTimeStr: string): string => {
    const kickoff = new Date(matchTimeStr);
    const now = new Date();
    const diffMs = kickoff.getTime() - now.getTime();
    
    if (diffMs <= 0) {
      return "Started";
    }
    
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `in ${days}d ${hours % 24}h`;
    }
    if (hours > 0) {
      return `in ${hours}h ${mins}m`;
    }
    return `in ${mins}m`;
  };

  const toggleSelectPrediction = (pred: Prediction) => {
    // Only allow selecting upcoming predictions that don't have a bet yet
    if (pred.status !== "upcoming" || pred.hasBet) return;

    setSelectedPredictions((prev) => {
      const exists = prev.some((p) => p.id === pred.id);
      if (exists) {
        return prev.filter((p) => p.id !== pred.id);
      } else {
        return [...prev, pred];
      }
    });
  };

  const handleRemoveSelection = (id: number) => {
    setSelectedPredictions((prev) => prev.filter((p) => p.id !== id));
  };

  const handlePlaceBetSlip = async () => {
    if (selectedPredictions.length === 0) return;
    setPlacingBet(true);
    setPlaceError(null);
    setPlaceSuccess(null);

    const payload = {
      selections: selectedPredictions.map((pred) => ({
        matchId: pred.matchId,
        selection: pred.predictedOutcome,
        odds: getSelectionOdds(pred),
      })),
      stake: customStake,
    };

    try {
      const res = await fetch("/api/place-slip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setPlaceSuccess(`Bet Slip #${data.slipId} placed successfully!`);
        setSelectedPredictions([]);
        // Refresh predictions list and settings bankroll
        await fetchData();
        setTimeout(() => setPlaceSuccess(null), 5000);
      } else {
        setPlaceError(data.error || "Failed to place bet slip.");
      }
    } catch (e: any) {
      setPlaceError(e.message || "An unexpected error occurred.");
    } finally {
      setPlacingBet(false);
    }
  };

  // Compute stats for current selections
  const combinedOdds = selectedPredictions.reduce((acc, pred) => acc * getSelectionOdds(pred), 1.0);
  const potentialPayout = customStake * combinedOdds;
  const insBalance = settings ? settings.accountBalance < customStake : false;

  // Calculate system accuracy condition
  // Winrate is percentage e.g. 85.0. targetAccuracy is decimal e.g. 0.9.
  const actualAccuracy = summary && (summary.wins + summary.losses) > 0 ? (summary.winRate / 100) : 1.0;
  const targetAccuracy = settings ? settings.targetAccuracy : 0.9;
  
  // Allowed if actual system accuracy is >= targetAccuracy - 0.10 (below but close to it) or higher
  const isAllowedToPlace = actualAccuracy >= (targetAccuracy - 0.10);

  // Filter by Tab
  const tabFiltered = predictionsList.filter((p) => {
    if (activeTab === "unplaced") {
      return !p.hasBet;
    } else if (activeTab === "placed_unsettled") {
      return p.hasBet && p.status === "upcoming";
    } else {
      return p.hasBet && p.status === "completed";
    }
  });

  // Filter by Search Query
  const searchedPredictions = tabFiltered.filter((p) => {
    const term = searchQuery.toLowerCase().trim();
    if (!term) return true;
    return (
      p.homeTeam.toLowerCase().includes(term) ||
      p.awayTeam.toLowerCase().includes(term) ||
      p.league.toLowerCase().includes(term)
    );
  });

  // Count helper for Tab badges
  const unplacedCount = predictionsList.filter((p) => !p.hasBet).length;
  const placedUnsettledCount = predictionsList.filter((p) => p.hasBet && p.status === "upcoming").length;
  const placedSettledCount = predictionsList.filter((p) => p.hasBet && p.status === "completed").length;

  // Pagination calculations
  const totalPages = Math.ceil(searchedPredictions.length / itemsPerPage);
  const safeCurrentPage = Math.min(currentPage, Math.max(1, totalPages));
  const paginatedPredictions = searchedPredictions.slice(
    (safeCurrentPage - 1) * itemsPerPage,
    safeCurrentPage * itemsPerPage
  );

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-12">
        <div className="text-center">
          <RefreshCw className="mx-auto h-10 w-10 animate-spin text-indigo-500 mb-4" />
          <p className="text-sm text-slate-400 font-medium">Loading LLM Predictions...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-6 mt-8 w-full">
      <div className="flex flex-col lg:flex-row gap-8 mb-12">
        {/* Left Side: Predictions list */}
        <div className="flex-1 min-w-0">
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl shadow-xl backdrop-blur-sm overflow-hidden">
            <div className="p-6 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-200">LLM Prediction Logs</h2>
                  {liveConnected && (
                    <span className="flex items-center gap-1 text-[9px] text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded select-none animate-in fade-in">
                      <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse"></span> LIVE
                    </span>
                  )}
                </div>
                <p className="text-slate-400 text-xs mt-1">
                  Full list of games analyzed. Select upcoming predictions to construct custom parlay slips.
                </p>
              </div>
              {settings && (
                <div className="bg-slate-950/60 border border-slate-800 px-4 py-2 rounded-xl flex items-center gap-2 self-start sm:self-auto">
                  <Wallet className="h-4 w-4 text-indigo-400" />
                  <span className="text-xs text-slate-400">Balance:</span>
                  <span className="text-sm font-bold text-indigo-400">₦{settings.accountBalance.toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* Search and Tabs Container */}
            <div className="p-6 border-b border-slate-800/80 bg-slate-950/20 flex flex-col md:flex-row gap-4 items-center justify-between">
              {/* Tabs */}
              <div className="flex bg-slate-950/80 p-1 rounded-xl border border-slate-800/60 w-full md:w-auto">
                <button
                  onClick={() => setActiveTab("unplaced")}
                  className={`flex-1 md:flex-initial px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                    activeTab === "unplaced"
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/10"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Not Placed ({unplacedCount})
                </button>
                <button
                  onClick={() => setActiveTab("placed_unsettled")}
                  className={`flex-1 md:flex-initial px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                    activeTab === "placed_unsettled"
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/10"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Placed & Unsettled ({placedUnsettledCount})
                </button>
                <button
                  onClick={() => setActiveTab("placed_settled")}
                  className={`flex-1 md:flex-initial px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                    activeTab === "placed_settled"
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/10"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Placed & Settled ({placedSettledCount})
                </button>
              </div>

              {/* Search Bar */}
              <div className="relative w-full md:w-72">
                <input
                  type="text"
                  placeholder="Search team or league..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 pl-9 text-xs focus:outline-none focus:border-indigo-500 text-slate-200"
                />
                <svg
                  className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-2 text-slate-500 hover:text-slate-300"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="divide-y divide-slate-800">
              {searchedPredictions.length === 0 ? (
                <div className="p-12 text-center text-slate-500 font-medium">
                  {searchQuery ? "No matches match your search criteria." : "No predictions in this category."}
                </div>
              ) : (
                paginatedPredictions.map((p) => {
                  const isSelected = selectedPredictions.some((sel) => sel.id === p.id);
                  const selectionOdds = getSelectionOdds(p);
                  const isUpcoming = p.status === "upcoming";
                  const canSelect = isUpcoming && !p.hasBet;

                  return (
                    <div 
                      key={p.id} 
                      onClick={() => canSelect && toggleSelectPrediction(p)}
                      className={`p-6 transition-all flex flex-col md:flex-row justify-between gap-6 ${
                        canSelect ? "hover:bg-slate-900/20 cursor-pointer" : ""
                      } ${isSelected ? "bg-indigo-500/5 hover:bg-indigo-500/10" : ""}`}
                    >
                      <div className="flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-semibold">
                            {p.league}
                          </span>
                          <span className="text-xs text-slate-500">
                            Predicted: {new Date(p.predictedAt).toLocaleString()}
                          </span>
                          <span 
                            title={new Date(p.matchTime).toLocaleString()}
                            className="text-xs text-indigo-400 font-semibold bg-indigo-950/30 border border-indigo-900/40 px-2 py-0.5 rounded cursor-help"
                          >
                            Kickoff: {formatRelativeTime(p.matchTime)}
                          </span>
                          {p.status === "completed" ? (
                            <>
                              <span className="text-[10px] bg-slate-950/80 text-slate-400 border border-slate-800 px-2 py-0.5 rounded font-bold uppercase">
                                Finished
                              </span>
                              {p.doubleChanceResult && (
                                p.doubleChanceResult.split(",").includes(p.predictedOutcome) ? (
                                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-bold uppercase">
                                    ✓ Won
                                  </span>
                                ) : (
                                  <span className="text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/30 px-2 py-0.5 rounded font-bold uppercase">
                                    ✗ Lost
                                  </span>
                                )
                              )}
                              {p.result && (
                                <span className="text-[10px] bg-slate-950/80 text-slate-400 border border-slate-800 px-2 py-0.5 rounded font-medium">
                                  Result: {p.result === "1" ? "Home Win (1)" : p.result === "2" ? "Away Win (2)" : "Draw (X)"}
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              {isUpcoming ? (
                                <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded font-bold uppercase">
                                  Upcoming
                                </span>
                              ) : (
                                <span className="text-[10px] bg-slate-950/80 text-slate-500 border border-slate-800 px-2 py-0.5 rounded font-bold uppercase">
                                  Finished
                                </span>
                              )}
                              {p.hasBet && (
                                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-bold uppercase">
                                  ✓ Slip Placed
                                </span>
                              )}
                            </>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-3">
                          {canSelect && (
                            <div className={`h-5 w-5 rounded border flex items-center justify-center transition-all ${
                              isSelected 
                                ? "bg-indigo-600 border-indigo-500 text-white" 
                                : "border-slate-700 bg-slate-950"
                            }`}>
                              {isSelected && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                            </div>
                          )}
                          <h3 className="text-base font-bold text-slate-200">
                            {p.homeTeam} vs {p.awayTeam}
                          </h3>
                        </div>
                        
                        <p className="text-sm text-slate-400 bg-slate-950/40 border border-slate-800/60 p-3.5 rounded-xl italic">
                          "{p.reasoning}"
                        </p>
                      </div>

                      <div className="flex flex-row md:flex-col justify-between md:justify-center items-end gap-3 min-w-[200px] border-t md:border-t-0 border-slate-800/60 pt-4 md:pt-0">
                        <div>
                          <div className="text-xs text-slate-500 font-semibold text-right">LLM Prediction</div>
                          <div className="text-2xl font-extrabold text-indigo-400 text-right mt-0.5">
                            {p.predictedOutcome}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-xs text-slate-500 font-semibold">Model Confidence</div>
                          <div className="flex items-center gap-1.5 justify-end mt-0.5">
                            <div className="w-16 bg-slate-800 h-2 rounded-full overflow-hidden">
                              <div 
                                className="bg-indigo-500 h-full rounded-full" 
                                style={{ width: `${p.confidence * 100}%` }}
                              ></div>
                            </div>
                            <span className="text-sm font-bold text-slate-300">
                              {Math.round(p.confidence * 100)}%
                            </span>
                          </div>
                        </div>

                        <div className="text-right text-xs text-slate-500">
                          Selection Odds: 
                          <span className="font-mono text-slate-200 font-bold ml-1.5 bg-slate-950/50 px-2 py-0.5 rounded border border-slate-850">
                            @{selectionOdds.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {totalPages > 1 && (
              <div className="p-4 border-t border-slate-800 flex items-center justify-between bg-slate-900/10">
                <button
                  type="button"
                  disabled={safeCurrentPage === 1}
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-800 bg-slate-950/40 text-xs font-semibold text-slate-400 hover:text-slate-200 hover:border-slate-700 transition-all disabled:opacity-30 disabled:cursor-not-allowed select-none cursor-pointer"
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </button>
                <span className="text-xs text-slate-400 font-medium select-none">
                  Page <span className="text-indigo-400 font-bold">{safeCurrentPage}</span> of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safeCurrentPage === totalPages}
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-850 bg-slate-950/40 text-xs font-semibold text-slate-400 hover:text-slate-200 hover:border-slate-700 transition-all disabled:opacity-30 disabled:cursor-not-allowed select-none cursor-pointer"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Bet slip builder */}
        <div className="w-full lg:w-96 shrink-0">
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 shadow-xl backdrop-blur-sm sticky top-24 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <Ticket className="h-5 w-5 text-indigo-400" />
                <h3 className="font-bold text-slate-200">Manual Bet Slip</h3>
              </div>
              {selectedPredictions.length > 0 && (
                <span className="bg-indigo-600/10 text-indigo-400 text-xs px-2.5 py-1 rounded-full font-bold">
                  {selectedPredictions.length} Games
                </span>
              )}
            </div>

            {selectedPredictions.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-sm font-medium">
                No predictions selected.
                <br />
                <span className="text-xs text-slate-600 mt-2 block">
                  Click on any upcoming prediction card to include it.
                </span>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Selections list */}
                <div className="max-h-60 overflow-y-auto space-y-3 pr-1">
                  {selectedPredictions.map((sel) => {
                    const odds = getSelectionOdds(sel);
                    return (
                      <div key={sel.id} className="bg-slate-950/40 border border-slate-850 p-3.5 rounded-xl relative group">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveSelection(sel.id);
                          }}
                          className="absolute top-2 right-2 text-slate-500 hover:text-rose-400 transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{sel.league}</div>
                        <div className="text-xs font-bold text-slate-200 mt-1 pr-6 truncate">
                          {sel.homeTeam} vs {sel.awayTeam}
                        </div>
                        <div className="flex justify-between items-center mt-2.5">
                          <span className="text-[10px] bg-indigo-500/10 text-indigo-400 font-bold px-2 py-0.5 rounded">
                            Selection: {sel.predictedOutcome}
                          </span>
                          <span className="text-xs font-mono font-bold text-slate-400">@{odds.toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Slip Details & Calculator */}
                <div className="bg-slate-950/30 rounded-xl p-4 border border-slate-800/80 space-y-3 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Combined Odds:</span>
                    <span className="font-mono font-bold text-slate-200">{combinedOdds.toFixed(2)}x</span>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-slate-850">
                    <label className="text-slate-400 font-medium block">Custom Stake (₦)</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="100"
                        value={customStake}
                        onChange={(e) => setCustomStake(Math.max(0, parseFloat(e.target.value) || 0))}
                        className={`flex-1 bg-slate-950 border rounded-xl px-3 py-2 text-xs font-mono font-bold focus:outline-none ${
                          insBalance ? "border-rose-500 focus:border-rose-500 text-rose-400" : "border-slate-800 focus:border-indigo-500 text-slate-200"
                        }`}
                      />
                    </div>
                    {/* Quick Stake presets */}
                    <div className="grid grid-cols-4 gap-1.5 mt-1.5">
                      {[500, 1000, 2000, 5000].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setCustomStake(val)}
                          className={`py-1 text-[10px] font-bold rounded-lg border transition-all ${
                            customStake === val
                              ? "bg-indigo-600/15 border-indigo-500/30 text-indigo-400"
                              : "bg-slate-900/40 border-slate-800 text-slate-400 hover:border-slate-700"
                          }`}
                        >
                          ₦{val}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-between items-baseline pt-3 border-t border-slate-850 text-sm">
                    <span className="text-slate-400 font-semibold">Potential Payout:</span>
                    <span className="text-lg font-extrabold text-emerald-400 font-mono">
                      ₦{potentialPayout.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                {placeError && (
                  <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl">
                    {placeError}
                  </div>
                )}

                {placeSuccess && (
                  <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-xl flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 shrink-0" />
                    <span>{placeSuccess}</span>
                  </div>
                )}

                 {!isAllowedToPlace && (
                  <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-3.5 rounded-xl">
                    Manual placement restricted: actual system accuracy ({(actualAccuracy * 100).toFixed(1)}%) is too far below target accuracy ({(targetAccuracy * 100).toFixed(1)}%).
                  </div>
                )}

                <button
                  type="button"
                  disabled={placingBet || insBalance || !isAllowedToPlace}
                  onClick={handlePlaceBetSlip}
                  className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-sm py-3 px-4 rounded-xl transition-all shadow-lg shadow-indigo-500/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {placingBet ? (
                    <span className="flex items-center justify-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin" /> Placing Slip...
                    </span>
                  ) : insBalance ? (
                    "Insufficient Balance"
                  ) : !isAllowedToPlace ? (
                    "Accuracy Restricted"
                  ) : (
                    "Place Custom Bet Slip"
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
