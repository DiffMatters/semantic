"use client";
import React, { useState } from 'react';
import { compareConfigs, detectFormats } from '@/lib/unified-diff';
import { AlertCircle, ArrowRight, FileJson, FileText, Settings } from 'lucide-react';

export default function ComparePage() {
  const [leftText, setLeftText] = useState('');
  const [rightText, setRightText] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [formats, setFormats] = useState<{left: string, right: string} | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCompare = () => {
    setError(null);
    try {
      const detected = detectFormats(leftText, rightText);
      setFormats(detected);
      const drift = compareConfigs(leftText, rightText);
      setResults(drift);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Unified Semantic Compare</h1>
          <p className="text-muted-foreground">
            Compare JSON, YAML, or .env files. Format is auto-detected.
          </p>
        </div>
        <div className="flex gap-2">
          <Settings size={20} className="text-muted-foreground opacity-50" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm font-medium opacity-70">
            <div className="flex items-center gap-2">
              <FileText size={14} /> Source
            </div>
            {formats?.left && (
              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[10px] uppercase font-bold">
                {formats.left}
              </span>
            )}
          </div>
          <textarea
            value={leftText}
            onChange={(e) => setLeftText(e.target.value)}
            className="w-full h-64 p-4 font-mono text-sm border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-slate-900"
            placeholder="Paste JSON, YAML, or .env content here..."
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm font-medium opacity-70">
            <div className="flex items-center gap-2">
              <FileJson size={14} /> Target
            </div>
            {formats?.right && (
              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[10px] uppercase font-bold">
                {formats.right}
              </span>
            )}
          </div>
          <textarea
            value={rightText}
            onChange={(e) => setRightText(e.target.value)}
            className="w-full h-64 p-4 font-mono text-sm border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-slate-900"
            placeholder="Paste JSON, YAML, or .env content here..."
          />
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleCompare}
          className="flex items-center gap-2 px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-full transition-all shadow-lg hover:shadow-blue-500/30"
        >
          Compare Semantically <ArrowRight size={18} />
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-xl flex items-start gap-3">
          <AlertCircle className="shrink-0 mt-0.5" size={18} />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {results && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Comparison Analysis</h2>
          <div className="overflow-hidden border rounded-2xl bg-white dark:bg-slate-900">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 dark:bg-slate-800 border-b">
                <tr>
                  <th className="px-4 py-3 font-medium">Key</th>
                  <th className="px-4 py-3 font-medium">Source Value</th>
                  <th className="px-4 py-3 font-medium">Target Value</th>
                  <th className="px-4 py-3 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {results.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3 font-mono font-medium">{row.key}</td>
                    <td className="px-4 py-3 opacity-70">{String(row.leftValue || '—')}</td>
                    <td className="px-4 py-3 opacity-70">{String(row.rightValue || '—')}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={cn(
                        "px-2 py-1 rounded-full text-xs font-bold uppercase",
                        row.status === 'match' ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                        row.status === 'drift' ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" :
                        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      )}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}
