"use client";

import React, { useState, useEffect } from "react";
import { RefreshCw, AlertCircle } from "lucide-react";
import SettingsNavigation from "@/components/SettingsNavigation";

interface SystemSettings {
  crawlingUrl: string;
  historicDataApiUrl: string;
  historicDataApiKey: string;
  minOdds: number;
  maxOdds: number;
  minConfidence: number;
  stake: number;
  ollamaUrl: string;
  llmProvider: string;
  llmModel: string;
  isSimulation: boolean;
  autoBetEnabled: boolean;
  accumulatorMinSize: number;
  accumulatorMaxSize: number;
  targetAccuracy: number;
  accountBalance: number;
  maxDailyStakePercent: number;
  seasonsToSync: string;
  cacheTime: number;
  pipelineFrequency: number;
}

const MODEL_PRESETS: Record<string, string[]> = {
  groq: [
    "deepseek-r1-distill-llama-70b",
    "llama-3.3-70b-versatile",
    "llama-3.1-70b-versatile",
    "llama-3.1-8b-instant",
    "mixtral-8x7b-32768",
    "gemma2-9b-it"
  ],
  gemini: ["gemini-1.5-flash", "gemini-1.5-pro"],
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"],
};

export default function ConfigSettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  
  // Ollama models list & status
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [fetchingOllama, setFetchingOllama] = useState(false);
  const [ollamaError, setOllamaError] = useState(false);

  // Custom model text input override
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [customModelText, setCustomModelText] = useState("");

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (res.ok) {
        setSettings(data);
        
        // Fetch Ollama models immediately if Ollama is selected
        if (data.llmProvider === "ollama") {
          fetchOllamaModels(data);
        }

        // Determine if current model is a preset or custom
        const provider = data.llmProvider;
        const model = data.llmModel;
        if (provider !== "ollama") {
          const presets = MODEL_PRESETS[provider] || [];
          if (!presets.includes(model)) {
            setIsCustomModel(true);
            setCustomModelText(model);
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch settings:", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchOllamaModels = async (currentSettings = settings) => {
    setFetchingOllama(true);
    setOllamaError(false);
    try {
      const res = await fetch("/api/ollama-models");
      const data = await res.json();
      if (res.ok && !data.error) {
        const models = data.models || [];
        setOllamaModels(models);
        if (currentSettings && currentSettings.llmProvider === "ollama" && models.length > 0) {
          if (!models.includes(currentSettings.llmModel)) {
            setSettings((prev) => prev ? { ...prev, llmModel: models[0] } : null);
          }
        }
      } else {
        setOllamaError(true);
      }
    } catch (e) {
      setOllamaError(true);
    } finally {
      setFetchingOllama(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  // Fetch Ollama tags whenever Ollama provider is selected
  useEffect(() => {
    if (settings?.llmProvider === "ollama") {
      fetchOllamaModels();
    }
  }, [settings?.llmProvider, settings?.ollamaUrl]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    let modelToSave = settings.llmModel;
    if (settings.llmProvider !== "ollama" && isCustomModel) {
      modelToSave = customModelText;
    }

    const payload = {
      ...settings,
      llmModel: modelToSave,
    };

    setSaveStatus("Saving...");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSaveStatus("Saved successfully!");
        setTimeout(() => setSaveStatus(null), 3000);
      } else {
        const data = await res.json();
        setSaveStatus("Error: " + data.error);
      }
    } catch (e: any) {
      setSaveStatus("Error: " + e.message);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-12">
        <div className="text-center">
          <RefreshCw className="mx-auto h-10 w-10 animate-spin text-indigo-500 mb-4" />
          <p className="text-sm text-slate-400 font-medium">Loading Configuration...</p>
        </div>
      </div>
    );
  }

  const currentPresets = settings ? MODEL_PRESETS[settings.llmProvider] || [] : [];

  return (
    <main className="max-w-7xl mx-auto px-6 mt-8 w-full">
      <SettingsNavigation />
      
      {settings && (
        <form onSubmit={handleSaveSettings} className="bg-slate-900/40 border border-slate-800/80 p-8 rounded-2xl shadow-xl backdrop-blur-sm space-y-8 max-w-4xl mx-auto mb-12 font-sans">
          <div>
            <h2 className="text-lg font-bold text-slate-200">System Configuration & Trade Terms</h2>
            <p className="text-slate-400 text-xs mt-1">
              Customize simulation balance limits, accumulator parameters, data endpoints, and LLM providers.
            </p>
          </div>

          {/* Simulated Balance & Limits */}
          <div className="space-y-4 border-t border-slate-800 pt-6">
            <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Bankroll & Risk Exposure</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-400 block">Simulated Balance (₦)</label>
                <input
                  type="number"
                  value={settings.accountBalance}
                  onChange={(e) => setSettings({ ...settings, accountBalance: parseFloat(e.target.value) })}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-semibold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-400 block">Base Stake per Slip (₦)</label>
                <input
                  type="number"
                  value={settings.stake}
                  onChange={(e) => setSettings({ ...settings, stake: parseFloat(e.target.value) })}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-semibold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-400 block">Max Daily Exposure (%)</label>
                <input
                  type="number"
                  value={settings.maxDailyStakePercent * 100}
                  onChange={(e) => setSettings({ ...settings, maxDailyStakePercent: parseFloat(e.target.value) / 100 })}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-semibold"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-400 block">Min Odds Limit</label>
                <input
                  type="number"
                  step="0.01"
                  value={settings.minOdds}
                  onChange={(e) => setSettings({ ...settings, minOdds: parseFloat(e.target.value) })}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-semibold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-400 block">Max Odds Limit</label>
                <input
                  type="number"
                  step="0.01"
                  value={settings.maxOdds}
                  onChange={(e) => setSettings({ ...settings, maxOdds: parseFloat(e.target.value) })}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-semibold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-400 block">Min Confidence Threshold (%)</label>
                <input
                  type="number"
                  step="1"
                  value={Math.round(settings.minConfidence * 100)}
                  onChange={(e) => setSettings({ ...settings, minConfidence: parseFloat(e.target.value) / 100 })}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-semibold"
                />
              </div>
            </div>
          </div>

          {/* Auto-Betting & Parlay Grouping */}
          <div className="space-y-4 border-t border-slate-800 pt-6">
            <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Parlay Trade Terms</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Automation</label>
                <label className="inline-flex items-center cursor-pointer bg-slate-850 px-4 py-2.5 rounded-xl border border-slate-700 select-none">
                  <input
                    type="checkbox"
                    checked={settings.autoBetEnabled}
                    onChange={(e) => setSettings({ ...settings, autoBetEnabled: e.target.checked })}
                    className="rounded border-slate-600 bg-slate-950 text-indigo-500 focus:ring-0 mr-2"
                  />
                  <span className="text-sm font-bold text-slate-200">Auto-Place Bet Slips</span>
                </label>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-400 block">Min Slip Size (Matches)</label>
                <input
                  type="number"
                  value={settings.accumulatorMinSize}
                  onChange={(e) => setSettings({ ...settings, accumulatorMinSize: parseInt(e.target.value) })}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-400 block">Max Slip Size (Matches)</label>
                <input
                  type="number"
                  value={settings.accumulatorMaxSize}
                  onChange={(e) => setSettings({ ...settings, accumulatorMaxSize: parseInt(e.target.value) })}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-400 block">Target System Accuracy (Decimal, e.g. 0.9)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.0"
                  max="1.0"
                  value={settings.targetAccuracy}
                  onChange={(e) => {
                    const parsed = parseFloat(e.target.value);
                    setSettings({ ...settings, targetAccuracy: isNaN(parsed) ? 0.0 : parseFloat(parsed.toFixed(1)) });
                  }}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-semibold"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Mode</label>
                <label className="inline-flex items-center cursor-pointer bg-slate-850 px-4 py-2.5 rounded-xl border border-slate-700 select-none">
                  <input
                    type="checkbox"
                    checked={settings.isSimulation}
                    onChange={(e) => setSettings({ ...settings, isSimulation: e.target.checked })}
                    className="rounded border-slate-600 bg-slate-950 text-indigo-500 focus:ring-0 mr-2"
                  />
                  <span className="text-sm font-bold text-slate-200">Simulation Trading Only</span>
                </label>
              </div>
            </div>
          </div>

          {/* Pipeline Scheduler & Cache Settings */}
          <div className="space-y-4 border-t border-slate-800 pt-6">
            <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">Pipeline Scheduler & Redis Cache</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-400 block">Pipeline Run Frequency (Minutes)</label>
                <input
                  type="number"
                  min="5"
                  value={settings.pipelineFrequency}
                  onChange={(e) => setSettings({ ...settings, pipelineFrequency: parseInt(e.target.value) || 30 })}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-semibold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-400 block">Redis Match Cache TTL (Minutes)</label>
                <input
                  type="number"
                  min="10"
                  value={settings.cacheTime}
                  onChange={(e) => setSettings({ ...settings, cacheTime: parseInt(e.target.value) || 120 })}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-semibold"
                />
              </div>
            </div>
          </div>

          {/* LLM Engine Selection */}
          <div className="space-y-4 border-t border-slate-800 pt-6">
            <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider">LLM Prediction Engine</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-400 block">AI Model Provider</label>
                <select
                  value={settings.llmProvider}
                  onChange={(e) => {
                    const newProvider = e.target.value;
                    const defaultModel =
                      newProvider === "ollama"
                        ? "llama3"
                        : MODEL_PRESETS[newProvider]?.[0] || "";
                    setSettings({ ...settings, llmProvider: newProvider, llmModel: defaultModel });
                    setIsCustomModel(false);
                  }}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                >
                  <option value="ollama">Ollama (Local LLM)</option>
                  <option value="groq">Groq (Cloud API - Llama 3.1, Gemma)</option>
                  <option value="gemini">Google Gemini (Cloud API - 1.5 Flash/Pro)</option>
                  <option value="openai">OpenAI (Cloud API - GPT-4o / mini)</option>
                </select>
              </div>

              {settings.llmProvider === "ollama" && (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-400 block">Ollama Base URL</label>
                  <input
                    type="text"
                    value={settings.ollamaUrl}
                    onChange={(e) => setSettings({ ...settings, ollamaUrl: e.target.value })}
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}
            </div>

            {/* Model Name Selector/Inputs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {settings.llmProvider === "ollama" ? (
                <div className="space-y-1 col-span-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-semibold text-slate-400">Available Ollama Models</label>
                    {fetchingOllama && <RefreshCw className="h-3 w-3 animate-spin text-indigo-400" />}
                  </div>

                  {ollamaError ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs">
                        <AlertCircle className="h-4 w-4" />
                        <span>Could not fetch models. Check that Ollama is running locally on {settings.ollamaUrl}.</span>
                      </div>
                      <input
                        type="text"
                        value={settings.llmModel}
                        onChange={(e) => setSettings({ ...settings, llmModel: e.target.value })}
                        placeholder="Type model name manually e.g., llama3"
                        className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  ) : (
                    <select
                      value={settings.llmModel}
                      onChange={(e) => setSettings({ ...settings, llmModel: e.target.value })}
                      className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                    >
                      {ollamaModels.length === 0 ? (
                        <option value="">No models found. Pull one first via 'ollama pull'</option>
                      ) : (
                        ollamaModels.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))
                      )}
                    </select>
                  )}
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-400">Model Selection</label>
                    <select
                      value={isCustomModel ? "custom" : settings.llmModel}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "custom") {
                          setIsCustomModel(true);
                        } else {
                          setIsCustomModel(false);
                          setSettings({ ...settings, llmModel: val });
                        }
                      }}
                      className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                    >
                      {currentPresets.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                      <option value="custom">Custom Model...</option>
                    </select>
                  </div>

                  {isCustomModel && (
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-400">Custom Model Name</label>
                      <input
                        type="text"
                        value={customModelText}
                        onChange={(e) => setCustomModelText(e.target.value)}
                        placeholder="Enter custom model identifier"
                        className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 pt-6 border-t border-slate-800">
            <button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold py-2.5 px-6 rounded-xl cursor-pointer"
            >
              Save Settings Configuration
            </button>
            {saveStatus && (
              <span className="text-sm font-semibold text-indigo-400 animate-pulse">
                {saveStatus}
              </span>
            )}
          </div>
        </form>
      )}
    </main>
  );
}
