import Link from "next/link";
import { ArrowRight, FileJson, FileText, Settings } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-20 space-y-16">
        <div className="text-center space-y-4">
          <h1 className="text-5xl font-extrabold tracking-tight lg:text-6xl">
            Config <span className="text-blue-600">Diff</span>
          </h1>
          <p className="text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
            Semantic comparison and drift analysis for your configuration files.
            Detect mismatches across environments regardless of format.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <ToolCard
            title="Unified Compare"
            description="Auto-detects JSON, YAML, and .env formats to perform a semantic diff."
            href="/compare"
            icon={<FileJson className="text-blue-500" />}
          />
          <ToolCard
            title="Semantic Diff"
            description="Deep dive into the differences between two configurations."
            href="/diff"
            icon={<FileText className="text-green-500" />}
          />
          <ToolCard
            title="Environment Drift"
            description="Check for mismatched variables between staging and production."
            href="/drift"
            icon={<Settings className="text-purple-500" />}
          />
        </div>

        <div className="pt-12 border-t border-slate-200 dark:border-slate-800 text-center">
          <p className="text-sm text-slate-500">
            Powered by semantic canonicalization to ignore key order and formatting.
          </p>
        </div>
      </main>
    </div>
  );
}

function ToolCard({ title, description, href, icon }: { title: string, description: string, href: string, icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-500 dark:hover:border-blue-500 transition-all hover:shadow-xl hover:shadow-blue-500/10 flex flex-col gap-4"
    >
      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 w-fit group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <div className="space-y-2">
        <h3 className="text-xl font-bold flex items-center gap-2">
          {title} <ArrowRight size={16} className="opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0 transition-transform" />
        </h3>
        <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">
          {description}
        </p>
      </div>
    </Link>
  );
}
