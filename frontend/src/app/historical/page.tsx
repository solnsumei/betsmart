"use client";

import React, { useState, useEffect } from "react";
import { Search, Users, Activity, BarChart3, ChevronLeft, ChevronRight, Calendar, AlertCircle } from "lucide-react";

interface HistoricalMatch {
  id: number;
  league: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  result: string;
  homeShots: number;
  awayShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homeCorners: number;
  awayCorners: number;
  homeFouls: number;
  awayFouls: number;
}

interface TeamStats {
  total: number;
  wins: number;
  draws: number;
  losses: number;
  goalsScored: number;
  goalsConceded: number;
}

interface H2HStats {
  totalGames: number;
  teamAWins: number;
  teamBWins: number;
  draws: number;
  teamAGoals: number;
  teamBGoals: number;
}

interface TeamForm {
  recentMatches: HistoricalMatch[];
  form: string[];
}

export default function HistoricalStatsPage() {
  const [activeTab, setActiveTab] = useState<"search" | "h2h">("search");
  const [teamList, setTeamList] = useState<string[]>([]);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLeague, setSelectedLeague] = useState("");
  const [matches, setMatches] = useState<HistoricalMatch[]>([]);
  const [teamStats, setTeamStats] = useState<TeamStats | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalMatchesCount, setTotalMatchesCount] = useState(0);
  const [loadingSearch, setLoadingSearch] = useState(false);

  useEffect(() => {
    const fetchTeams = async () => {
      try {
        const url = selectedLeague
          ? `/api/historical-teams?league=${encodeURIComponent(selectedLeague)}`
          : "/api/historical-teams";
        const res = await fetch(url);
        const data = await res.json();
        if (res.ok && data.success) {
          setTeamList(data.teams || []);
        }
      } catch (e) {
        console.error("Failed to fetch unique teams list:", e);
      }
    };
    fetchTeams();
  }, [selectedLeague]);

  // H2H state
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [h2hMatches, setH2hMatches] = useState<HistoricalMatch[]>([]);
  const [h2hStats, setH2hStats] = useState<H2HStats | null>(null);
  const [teamAForm, setTeamAForm] = useState<TeamForm | null>(null);
  const [teamBForm, setTeamBForm] = useState<TeamForm | null>(null);
  const [loadingH2h, setLoadingH2h] = useState(false);
  
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Auto-suggestion dropdown visibility states
  const [showQuerySuggestions, setShowQuerySuggestions] = useState(false);
  const [showASuggestions, setShowASuggestions] = useState(false);
  const [showBSuggestions, setShowBSuggestions] = useState(false);

  const fetchClubMatches = async (targetPage = 1) => {
    if (!searchQuery.trim() && !selectedLeague) return;
    setLoadingSearch(true);
    setErrorMessage(null);
    try {
      const params = new URLSearchParams({
        page: targetPage.toString(),
        limit: "15",
      });
      if (searchQuery.trim()) params.append("teamA", searchQuery.trim());
      if (selectedLeague) params.append("league", selectedLeague);

      const res = await fetch(`/api/historical-matches?${params.toString()}`);
      const data = await res.json();
      
      if (res.ok) {
        setMatches(data.matches || []);
        setTeamStats(data.teamStats);
        setPage(data.pagination.page);
        setTotalPages(data.pagination.pages);
        setTotalMatchesCount(data.pagination.total);
      } else {
        setErrorMessage(data.error || "Failed to fetch matches");
      }
    } catch (e: any) {
      setErrorMessage("Error: " + e.message);
    } finally {
      setLoadingSearch(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchClubMatches(1);
  };

  const fetchH2H = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamA.trim() || !teamB.trim()) {
      setErrorMessage("Please enter names for both opponents");
      return;
    }
    setLoadingH2h(true);
    setErrorMessage(null);
    try {
      const params = new URLSearchParams({
        teamA: teamA.trim(),
        teamB: teamB.trim(),
      });
      const res = await fetch(`/api/historical-matches?${params.toString()}`);
      const data = await res.json();

      if (res.ok) {
        if (data.type === "h2h") {
          setH2hMatches(data.h2hMatches || []);
          setH2hStats(data.stats);
          setTeamAForm(data.teamAForm);
          setTeamBForm(data.teamBForm);
        }
      } else {
        setErrorMessage(data.error || "Failed to compare opponents");
      }
    } catch (e: any) {
      setErrorMessage("Error comparing teams: " + e.message);
    } finally {
      setLoadingH2h(false);
    }
  };

  // Helper to format result badges
  const getResultBadge = (result: string, isHome: boolean) => {
    if (result === "D") {
      return <span className="px-2 py-0.5 rounded text-xs font-bold bg-slate-700/50 text-slate-300 border border-slate-600/30">D</span>;
    }
    const won = (result === "H" && isHome) || (result === "A" && !isHome);
    if (won) {
      return <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">W</span>;
    }
    return <span className="px-2 py-0.5 rounded text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">L</span>;
  };

  const getFormBubble = (letter: string) => {
    switch (letter) {
      case "W":
        return <span key={Math.random()} className="h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">W</span>;
      case "D":
        return <span key={Math.random()} className="h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold bg-slate-700 text-slate-300 border border-slate-650">D</span>;
      default:
        return <span key={Math.random()} className="h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">L</span>;
    }
  };

  const filteredQueryTeams = searchQuery.trim().length >= 2
    ? teamList.filter((t) => t.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 8)
    : [];

  const filteredATeams = teamA.trim().length >= 2
    ? teamList.filter((t) => t.toLowerCase().includes(teamA.toLowerCase())).slice(0, 8)
    : [];

  const filteredBTeams = teamB.trim().length >= 2
    ? teamList.filter((t) => t.toLowerCase().includes(teamB.toLowerCase())).slice(0, 8)
    : [];

  return (
    <main className="max-w-7xl mx-auto px-6 mt-8 w-full font-sans mb-12">
      {/* Tab Switchers */}
      <div className="flex justify-between items-center border-b border-slate-800 pb-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Historical Database Explorer</h2>
          <p className="text-xs text-slate-400 mt-1">Search leagues, clubs, and evaluate head-to-head match histories.</p>
        </div>
        <div className="flex bg-slate-950/50 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => { setActiveTab("search"); setErrorMessage(null); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 select-none cursor-pointer ${
              activeTab === "search"
                ? "bg-indigo-600/25 border border-indigo-500/30 text-indigo-400"
                : "border border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Search className="h-4 w-4" />
            Club Search
          </button>
          <button
            onClick={() => { setActiveTab("h2h"); setErrorMessage(null); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 select-none cursor-pointer ${
              activeTab === "h2h"
                ? "bg-indigo-600/25 border border-indigo-500/30 text-indigo-400"
                : "border border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Users className="h-4 w-4" />
            Head-to-Head
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="flex items-center gap-3 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl mb-6 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* SEARCH TAB */}
      {activeTab === "search" && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Controls Panel */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl backdrop-blur-sm shadow-xl">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4">Query filters</h3>
              <form onSubmit={handleSearchSubmit} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-400">Club Name</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="e.g. Chelsea"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setShowQuerySuggestions(true);
                      }}
                      onFocus={() => setShowQuerySuggestions(true)}
                      onBlur={() => setTimeout(() => setShowQuerySuggestions(false), 200)}
                      className="w-full bg-slate-950/60 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                    />
                    <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />

                    {showQuerySuggestions && filteredQueryTeams.length > 0 && (
                      <div className="absolute z-20 w-full mt-1 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-h-60 overflow-y-auto divide-y divide-slate-850">
                        {filteredQueryTeams.map((team) => (
                          <button
                            key={team}
                            type="button"
                            onClick={() => {
                              setSearchQuery(team);
                              setShowQuerySuggestions(false);
                            }}
                            className="w-full text-left px-4 py-2 text-xs text-slate-200 hover:bg-slate-800 hover:text-white transition-all font-semibold cursor-pointer"
                          >
                            {team}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-400">League</label>
                  <select
                    value={selectedLeague}
                    onChange={(e) => setSelectedLeague(e.target.value)}
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">All Leagues</option>
                    <option value="Premier League">Premier League (E0)</option>
                    <option value="Championship">Championship (E1)</option>
                    <option value="La Liga">La Liga (SP1)</option>
                    <option value="Serie A">Serie A (I1)</option>
                    <option value="Bundesliga">Bundesliga (D1)</option>
                    <option value="Ligue 1">Ligue 1 (F1)</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={loadingSearch}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold py-2.5 rounded-xl cursor-pointer transition-all active:scale-98 disabled:opacity-50"
                >
                  {loadingSearch ? "Searching..." : "Search Matches"}
                </button>
              </form>
            </div>

            {/* Overall Stats Card */}
            {teamStats && searchQuery && (
              <div className="bg-gradient-to-br from-indigo-950/30 to-slate-900/40 border border-indigo-900/30 p-6 rounded-2xl shadow-xl">
                <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  {searchQuery} Stats
                </h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-slate-950/40 p-2.5 rounded-xl border border-slate-850">
                      <div className="text-xs text-slate-500">Played</div>
                      <div className="text-lg font-bold text-slate-200 mt-0.5">{teamStats.total}</div>
                    </div>
                    <div className="bg-emerald-500/5 p-2.5 rounded-xl border border-emerald-500/10">
                      <div className="text-xs text-emerald-500">Wins</div>
                      <div className="text-lg font-bold text-emerald-400 mt-0.5">{teamStats.wins}</div>
                    </div>
                    <div className="bg-rose-500/5 p-2.5 rounded-xl border border-rose-500/10">
                      <div className="text-xs text-rose-500">Losses</div>
                      <div className="text-lg font-bold text-rose-400 mt-0.5">{teamStats.losses}</div>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between py-1.5 border-b border-slate-800/60">
                      <span className="text-slate-400">Draws</span>
                      <span className="font-semibold text-slate-200">{teamStats.draws} ({((teamStats.draws / teamStats.total) * 100).toFixed(0)}%)</span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-slate-800/60">
                      <span className="text-slate-400">Goals Scored</span>
                      <span className="font-semibold text-slate-200">{teamStats.goalsScored} ({((teamStats.goalsScored / teamStats.total) || 0).toFixed(2)} / match)</span>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <span className="text-slate-400">Goals Conceded</span>
                      <span className="font-semibold text-slate-200">{teamStats.goalsConceded} ({((teamStats.goalsConceded / teamStats.total) || 0).toFixed(2)} / match)</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Results Panel */}
          <div className="lg:col-span-3">
            {loadingSearch ? (
              <div className="bg-slate-900/20 border border-slate-800/60 rounded-2xl p-16 flex items-center justify-center">
                <div className="text-center">
                  <Activity className="h-8 w-8 animate-pulse text-indigo-500 mx-auto mb-3" />
                  <p className="text-sm text-slate-400 font-medium">Loading search results...</p>
                </div>
              </div>
            ) : matches.length === 0 ? (
              <div className="bg-slate-900/20 border border-slate-800/60 rounded-2xl p-16 flex items-center justify-center text-center">
                <div>
                  <Search className="h-10 w-10 text-slate-650 mx-auto mb-3" />
                  <h4 className="text-base font-bold text-slate-300">No matches found</h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm">
                    Enter a club name or select a league to display match records. Make sure you've ingested data in settings.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-center text-xs text-slate-400 px-2">
                  <span>Found {totalMatchesCount} historical records</span>
                  <span>Page {page} of {totalPages}</span>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/40 shadow-xl backdrop-blur-sm">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/20 text-slate-400 font-semibold uppercase tracking-wider">
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-4">League</th>
                        <th className="py-3 px-4 text-right">Home Team</th>
                        <th className="py-3 px-2 text-center">Score</th>
                        <th className="py-3 px-4 text-left">Away Team</th>
                        {searchQuery && <th className="py-3 px-4 text-center">Result</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {matches.map((match) => {
                        const isSearchHome = match.homeTeam.toLowerCase().includes(searchQuery.toLowerCase());
                        const isSearchAway = match.awayTeam.toLowerCase().includes(searchQuery.toLowerCase());
                        return (
                          <tr key={match.id} className="hover:bg-slate-800/20 transition-all text-slate-300">
                            <td className="py-3 px-4 text-slate-400 font-medium">
                              {new Date(match.date).toLocaleDateString(undefined, {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })}
                            </td>
                            <td className="py-3 px-4 font-semibold text-slate-400">{match.league}</td>
                            <td className={`py-3 px-4 text-right font-medium ${isSearchHome ? "text-indigo-400 font-bold" : "text-slate-200"}`}>
                              {match.homeTeam}
                            </td>
                            <td className="py-3 px-2 text-center font-bold bg-slate-950/20 font-mono text-sm text-slate-200">
                              {match.homeGoals} - {match.awayGoals}
                            </td>
                            <td className={`py-3 px-4 text-left font-medium ${isSearchAway ? "text-indigo-400 font-bold" : "text-slate-200"}`}>
                              {match.awayTeam}
                            </td>
                            {searchQuery && (
                              <td className="py-3 px-4 text-center">
                                {getResultBadge(match.result, isSearchHome)}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex justify-between items-center pt-2">
                    <button
                      onClick={() => fetchClubMatches(page - 1)}
                      disabled={page === 1}
                      className="flex items-center gap-1 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 text-xs py-1.5 px-3 rounded-lg disabled:opacity-50 cursor-pointer font-semibold"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Prev
                    </button>
                    <span className="text-xs font-semibold text-slate-400">Page {page} of {totalPages}</span>
                    <button
                      onClick={() => fetchClubMatches(page + 1)}
                      disabled={page === totalPages}
                      className="flex items-center gap-1 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 text-xs py-1.5 px-3 rounded-lg disabled:opacity-50 cursor-pointer font-semibold"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* H2H COMPARATOR TAB */}
      {activeTab === "h2h" && (
        <div className="space-y-8">
          {/* Comparison Form */}
          <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl backdrop-blur-sm shadow-xl max-w-3xl mx-auto">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 text-center">Opponent Comparison</h3>
            <form onSubmit={fetchH2H} className="flex flex-col sm:flex-row items-end gap-4">
              <div className="flex-1 space-y-1 relative">
                <label className="text-xs font-semibold text-slate-400">Team A</label>
                <input
                  type="text"
                  placeholder="e.g. Manchester United"
                  value={teamA}
                  onChange={(e) => {
                    setTeamA(e.target.value);
                    setShowASuggestions(true);
                  }}
                  onFocus={() => setShowASuggestions(true)}
                  onBlur={() => setTimeout(() => setShowASuggestions(false), 200)}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
                
                {showASuggestions && filteredATeams.length > 0 && (
                  <div className="absolute z-20 w-full mt-1 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-h-60 overflow-y-auto divide-y divide-slate-850">
                    {filteredATeams.map((team) => (
                      <button
                        key={team}
                        type="button"
                        onClick={() => {
                          setTeamA(team);
                          setShowASuggestions(false);
                        }}
                        className="w-full text-left px-4 py-2 text-xs text-slate-200 hover:bg-slate-800 hover:text-white transition-all font-semibold cursor-pointer"
                      >
                        {team}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-center font-bold text-slate-500 self-center pb-2.5">
                VS
              </div>

              <div className="flex-1 space-y-1 relative">
                <label className="text-xs font-semibold text-slate-400">Team B</label>
                <input
                  type="text"
                  placeholder="e.g. Liverpool"
                  value={teamB}
                  onChange={(e) => {
                    setTeamB(e.target.value);
                    setShowBSuggestions(true);
                  }}
                  onFocus={() => setShowBSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowBSuggestions(false), 200)}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />

                {showBSuggestions && filteredBTeams.length > 0 && (
                  <div className="absolute z-20 w-full mt-1 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-h-60 overflow-y-auto divide-y divide-slate-850">
                    {filteredBTeams.map((team) => (
                      <button
                        key={team}
                        type="button"
                        onClick={() => {
                          setTeamB(team);
                          setShowBSuggestions(false);
                        }}
                        className="w-full text-left px-4 py-2 text-xs text-slate-200 hover:bg-slate-800 hover:text-white transition-all font-semibold cursor-pointer"
                      >
                        {team}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={loadingH2h}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold py-2.5 px-6 rounded-xl transition-all cursor-pointer disabled:opacity-50 w-full sm:w-auto"
              >
                {loadingH2h ? "Loading..." : "Compare"}
              </button>
            </form>
          </div>

          {loadingH2h ? (
            <div className="p-16 flex items-center justify-center">
              <div className="text-center">
                <Activity className="h-8 w-8 animate-pulse text-indigo-500 mx-auto mb-3" />
                <p className="text-sm text-slate-400">Analyzing Head-to-Head and Form Streaks...</p>
              </div>
            </div>
          ) : h2hStats ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left Column: Form & Statistics */}
              <div className="lg:col-span-1 space-y-6">
                {/* H2H Win Ratio Panel */}
                <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl shadow-xl">
                  <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider mb-4">H2H Win/Draw Record</h3>
                  
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>Total Meetings</span>
                      <span className="font-bold text-slate-200">{h2hStats.totalGames}</span>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-slate-300">{teamA} Wins</span>
                          <span className="font-bold text-emerald-400">{h2hStats.teamAWins} ({h2hStats.totalGames ? ((h2hStats.teamAWins / h2hStats.totalGames) * 100).toFixed(0) : 0}%)</span>
                        </div>
                        <div className="h-2 bg-slate-950 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-emerald-500 rounded-full" 
                            style={{ width: `${h2hStats.totalGames ? (h2hStats.teamAWins / h2hStats.totalGames) * 100 : 0}%` }}
                          ></div>
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-slate-300">{teamB} Wins</span>
                          <span className="font-bold text-indigo-400">{h2hStats.teamBWins} ({h2hStats.totalGames ? ((h2hStats.teamBWins / h2hStats.totalGames) * 100).toFixed(0) : 0}%)</span>
                        </div>
                        <div className="h-2 bg-slate-950 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-indigo-500 rounded-full" 
                            style={{ width: `${h2hStats.totalGames ? (h2hStats.teamBWins / h2hStats.totalGames) * 100 : 0}%` }}
                          ></div>
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-slate-300">Draws</span>
                          <span className="font-bold text-slate-400">{h2hStats.draws} ({h2hStats.totalGames ? ((h2hStats.draws / h2hStats.totalGames) * 100).toFixed(0) : 0}%)</span>
                        </div>
                        <div className="h-2 bg-slate-950 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-slate-650 rounded-full" 
                            style={{ width: `${h2hStats.totalGames ? (h2hStats.draws / h2hStats.totalGames) * 100 : 0}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Goal Statistics */}
                <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl shadow-xl">
                  <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider mb-4">Goal Distributions</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-850 text-center">
                      <div className="text-xs text-slate-500">{teamA}</div>
                      <div className="text-xl font-bold text-slate-200 mt-1">{h2hStats.teamAGoals}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">({h2hStats.totalGames ? (h2hStats.teamAGoals / h2hStats.totalGames).toFixed(1) : 0} per game)</div>
                    </div>
                    <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-850 text-center">
                      <div className="text-xs text-slate-500">{teamB}</div>
                      <div className="text-xl font-bold text-slate-200 mt-1">{h2hStats.teamBGoals}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">({h2hStats.totalGames ? (h2hStats.teamBGoals / h2hStats.totalGames).toFixed(1) : 0} per game)</div>
                    </div>
                  </div>
                </div>

                {/* Form Streaks */}
                {teamAForm && teamBForm && (
                  <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl shadow-xl space-y-4">
                    <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Recent Form Streak</h3>
                    
                    <div className="space-y-3">
                      <div>
                        <span className="text-xs text-slate-400 block mb-1.5">{teamA}</span>
                        <div className="flex gap-1.5">
                          {teamAForm.form.slice(0, 8).map(getFormBubble)}
                        </div>
                      </div>

                      <div>
                        <span className="text-xs text-slate-400 block mb-1.5">{teamB}</span>
                        <div className="flex gap-1.5">
                          {teamBForm.form.slice(0, 8).map(getFormBubble)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Head-to-Head Meeting List */}
              <div className="lg:col-span-2 space-y-4">
                <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider px-2">H2H Match History</h3>
                
                {h2hMatches.length === 0 ? (
                  <div className="bg-slate-900/20 border border-slate-800/60 rounded-2xl p-12 text-center text-slate-500 text-xs">
                    No head-to-head records found between these two teams in the current database.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {h2hMatches.map((m) => {
                      const isAHome = m.homeTeam.toLowerCase() === teamA.toLowerCase();
                      return (
                        <div key={m.id} className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-center gap-3 hover:border-slate-700/80 transition-all">
                          <div className="flex items-center gap-2 text-[11px] text-slate-500">
                            <Calendar className="h-3.5 w-3.5" />
                            <span>{new Date(m.date).toLocaleDateString()}</span>
                            <span>•</span>
                            <span className="font-semibold">{m.league}</span>
                          </div>

                          <div className="flex items-center justify-center gap-4 text-xs font-semibold">
                            <span className={`w-28 text-right truncate ${isAHome ? "text-indigo-400 font-bold" : "text-slate-300"}`}>
                              {m.homeTeam}
                            </span>
                            <span className="bg-slate-950 py-1 px-3 rounded-lg font-bold font-mono text-slate-100">
                              {m.homeGoals} - {m.awayGoals}
                            </span>
                            <span className={`w-28 text-left truncate ${!isAHome ? "text-indigo-400 font-bold" : "text-slate-300"}`}>
                              {m.awayTeam}
                            </span>
                          </div>

                          <div className="text-[10px] text-slate-400 font-semibold px-2 py-0.5 bg-slate-950/30 rounded border border-slate-800">
                            {m.result === "D" ? "Draw" : m.result === "H" ? `${m.homeTeam} Win` : `${m.awayTeam} Win`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/20 border border-slate-800/60 rounded-2xl p-16 flex items-center justify-center text-center max-w-3xl mx-auto">
              <div>
                <Users className="h-10 w-10 text-slate-650 mx-auto mb-3" />
                <h4 className="text-base font-bold text-slate-300">Compare Head-to-Heads</h4>
                <p className="text-xs text-slate-500 mt-1">
                  Type the names of two clubs and hit Compare to check their direct matchup history, goals distribution, and current form streak side-by-side.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
