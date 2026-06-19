"use client";

import React from "react";
import Link from "next/link";
import { Settings as SettingsIcon, Database, Activity, ChevronRight } from "lucide-react";

export default function SettingsHubPage() {
  const categories = [
    {
      href: "/settings/config",
      label: "System Configuration",
      description: "Manage simulated bankroll limits, accumulator parlay parameters, minimum confidence thresholds, and active AI model selection (Groq, Gemini, OpenAI, or local Ollama).",
      icon: SettingsIcon,
      accentColor: "from-indigo-650 to-indigo-500",
      iconColor: "text-indigo-400"
    },
    {
      href: "/settings/data",
      label: "Historical Data Ingestion",
      description: "Manage historical match CSV ingestion, choose which football seasons are synced locally, and monitor local database stats across different football leagues.",
      icon: Database,
      accentColor: "from-violet-650 to-violet-500",
      iconColor: "text-violet-400"
    },
    {
      href: "/settings/runs",
      label: "Crawl Execution Logs",
      description: "View Playwright crawler scraping target URLs (e.g. league specific pages), trace crawl execution histories, duration metrics, scraped match logs, and predictions generated.",
      icon: Activity,
      accentColor: "from-emerald-650 to-emerald-500",
      iconColor: "text-emerald-400"
    }
  ];

  return (
    <main className="max-w-6xl mx-auto px-6 mt-12 w-full font-sans">
      <div className="mb-10 text-center sm:text-left">
        <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-slate-100 via-slate-200 to-indigo-200 bg-clip-text text-transparent">
          System Control Center
        </h2>
        <p className="text-slate-400 text-sm mt-2 max-w-xl">
          Adjust risk settings, manage historical dataset imports, configure web scraper targets, and monitor LLM pipeline executions.
        </p>
      </div>

      <div className="flex flex-col gap-4 max-w-4xl mb-16">
        {categories.map((category) => {
          const Icon = category.icon;
          return (
            <Link
              key={category.href}
              href={category.href}
              className="group relative bg-slate-900/35 border border-slate-800/85 hover:border-slate-700/60 p-5 rounded-2xl shadow-xl backdrop-blur-sm transition-all duration-250 hover:-translate-y-0.5 flex flex-col sm:flex-row items-start sm:items-center gap-5 justify-between"
            >
              <div className="flex items-start sm:items-center gap-5 flex-1">
                <div className={`h-12 w-12 shrink-0 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-center group-hover:scale-105 transition-transform`}>
                  <Icon className={`h-6 w-6 ${category.iconColor}`} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-slate-200 group-hover:text-white transition-colors">
                    {category.label}
                  </h3>
                  <p className="text-slate-400 text-xs leading-relaxed max-w-2xl">
                    {category.description}
                  </p>
                </div>
              </div>

              <div className="shrink-0 flex items-center text-xs font-bold text-slate-400 group-hover:text-indigo-400 transition-colors self-end sm:self-auto">
                Open Section
                <ChevronRight className="h-4 w-4 ml-1 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
