"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings as SettingsIcon, Database, Activity, ChevronLeft } from "lucide-react";

export default function SettingsNavigation() {
  const pathname = usePathname();

  const tabs = [
    { href: "/settings/config", label: "System Config", icon: SettingsIcon },
    { href: "/settings/data", label: "Historical Data", icon: Database },
    { href: "/settings/runs", label: "Crawl Runs & Logs", icon: Activity },
  ];

  return (
    <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between border-b border-slate-800/80 pb-5 mb-8 max-w-4xl mx-auto w-full">
      <Link
        href="/settings"
        className="flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-slate-200 transition-colors group"
      >
        <ChevronLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
        Back to Settings Hub
      </Link>

      <div className="flex gap-1.5 bg-slate-950/40 p-1 rounded-xl border border-slate-800/80 w-full sm:w-auto overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap select-none flex-1 sm:flex-none ${
                isActive
                  ? "bg-indigo-600/10 border border-indigo-500/30 text-indigo-400"
                  : "border border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
