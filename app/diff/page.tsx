"use client";
import React, { useState } from 'react';
import { parseConfig } from '@/lib/parsers';
import { computeSemanticDiff } from '@/lib/diff-engine';
import { AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react';

export default function DiffPage() {
  const [leftText, setLeftText] = useState('');
  const [rightText, setRightText] = useState('');
  const [format, setFormat] = useState<'json' | 'yaml' | 'env'>('json');
  const [delta, setDelta] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCompare = () => {
    setError(null);
    try {
      const left = parseConfig(leftText, format);
      const right = parseConfig(rightText, format);
      const result = computeSemanticDiff(left, right);
      setDelta(result);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Semantic Diff</h1>
          <p className="text-muted-foreground">Compare configurations while ignoring formatting and key order.</p>
        </div>
        <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          {(['json', 'yaml', 'env'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={cn(
                "px-3 py-1 text-sm font-medium rounded-md transition-all",
                format === f
                  ? "bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              )}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-sm font-medium opacity-70">Source Configuration</label>
          <textarea
            value={leftText}
            onChange={(e) => setLeftText(e.target.value)}
            className="w-full h-64 p-4 font-mono text-sm border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-slate-900"
            placeholder={`Paste ${format.toUpperCase()} here...`}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium opacity-70">Target Configuration</label>
          <textarea
            value={rightText}
            onChange={(e) => setRightText(e.target.value)}
            className="w-full h-64 p-4 font-mono text-sm border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white dark:bg-slate-900"
            placeholder={`Paste ${format.toUpperCase()} here...`}
          />
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleCompare}
          className="flex items-center gap-2 px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-full transition-all shadow-lg hover:shadow-blue-500/30"
        >
          Compare <ArrowRight size={18} />
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-xl flex items-start gap-3">
          <AlertCircle className="shrink-0 mt-0.5" size={18} />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {delta === null && !error && (
        <div className="text-center py-20 opacity-40 border-2 border-dashed rounded-3xl">
          <p>Enter configurations and click compare to see the semantic diff.</p>
        </div>
      )}

      {delta === null && !error && false && (
        <div className="p-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-600 dark:text-green-400 rounded-xl flex items-center gap-3">
          <CheckCircle2 size={18} />
          <p className="text-sm font-medium">Configurations are semantically identical!</p>
        </div>
      )}

      {delta && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Differences Found</h2>
          <div className="p-6 bg-white dark:bg-slate-900 border rounded-2xl font-mono text-sm overflow-auto">
            <pre className="whitespace-pre-wrap">
              {JSON.stringify(delta, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}
