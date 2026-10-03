"use client";
import React, { useState } from 'react';
import { parseConfig } from '@/lib/parsers';
import { checkDrift } from '@/lib/drift-checker';
import { AlertCircle, ArrowRight, Database, Globe } from 'lucide-react';

export default function DriftPage() {
  const [leftText, setLeftText] = useState('');
  const [rightText, setRightText] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheck = () => {
    setError(null);
    try {
      const left = parseConfig(leftText, 'env');
      const right = parseConfig(rightText, 'env');
      const drift = checkDrift(left, right);
      setResults(drift);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Environment Drift</h1>
          <p className="text-muted-foreground">Check for mismatched variables between two environments.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium opacity-70">
            <Globe size={14} /> Source (e.g. Staging)
          </div>
          <textarea
            value={leftText}
            onChange={(e) => setLeftText(e.target.value)}
            className="w-full h-64 p-4 font-mono text-sm border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-slate-900"
            placeholder="KEY=VALUE..."
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium opacity-70">
            <Database size={14} /> Target (e.g. Production)
          </div>
          <textarea
            value={rightText}
            onChange={(e) => setRightText(e.target.value)}
            className="w-full h-64 p-4 font-mono text-sm border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-slate-900"
            placeholder="KEY=VALUE..."
          />
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleCheck}
          className="flex items-center gap-2 px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-full transition-all shadow-lg hover:shadow-blue-500/30"
        >
          Check Drift <ArrowRight size={18} />
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
          <h2 className="text-xl font-semibold">Drift Analysis</h2>
          <div className="overflow-hidden border rounded-2xl bg-white dark:bg-slate-900">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 dark:bg-slate-800 border-b">
                <tr>
                  <th className="px-4 py-3 font-medium">Variable</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Target</th>
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
