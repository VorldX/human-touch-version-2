"use client";

import { type ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Coins, Loader2, RefreshCw, Workflow } from "lucide-react";

import { parseJsonResponse } from "@/lib/http/json-response";
import { useVorldXStore } from "@/lib/store/vorldx-store";

interface MarketAsset {
  id: string;
  type: "HUMAN" | "AI";
  name: string;
  role: string;
  status: string;
  isRented: boolean;
  pricingModel: "TOKEN" | "SUBSCRIPTION" | "OUTCOME" | null;
  autonomyScore: number;
  baseRate: number;
  dynamicRate: number;
  rentRate: number;
  assignedOAuthIds: string[];
}

interface MarketMetrics {
  listedCount: number;
  rentedCount: number;
  averageAutonomy: number;
  contractYieldPerHour: number;
}

interface CollaborationConsoleProps {
  orgId: string;
  themeStyle: {
    accent: string;
    accentSoft: string;
    border: string;
  };
}

export function CollaborationConsole({ orgId, themeStyle }: CollaborationConsoleProps) {
  const notify = useVorldXStore((state) => state.pushNotification);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listedAssets, setListedAssets] = useState<MarketAsset[]>([]);
  const [rentedAssets, setRentedAssets] = useState<MarketAsset[]>([]);
  const [metrics, setMetrics] = useState<MarketMetrics>({
    listedCount: 0,
    rentedCount: 0,
    averageAutonomy: 0,
    contractYieldPerHour: 0
  });
  const [liveYield, setLiveYield] = useState(0);

  const loadMarketplace = useCallback(
    async (silent?: boolean) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const response = await fetch(`/api/collab/marketplace?orgId=${encodeURIComponent(orgId)}`, {
          cache: "no-store"
        });
        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          listedAssets?: MarketAsset[];
          rentedAssets?: MarketAsset[];
          metrics?: MarketMetrics;
        }>(response);

        if (!response.ok || !payload?.ok || !payload.metrics) {
          setError(
            payload?.message ??
              (rawText
                ? `Failed to load marketplace (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed to load marketplace.")
          );
          return;
        }

        setError(null);
        setListedAssets(payload.listedAssets ?? []);
        setRentedAssets(payload.rentedAssets ?? []);
        setMetrics(payload.metrics);
        setLiveYield(payload.metrics.contractYieldPerHour);
      } catch (requestError) {
        setError(
          requestError instanceof Error ? requestError.message : "Failed to load marketplace."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [orgId]
  );

  useEffect(() => {
    void loadMarketplace();
    const interval = setInterval(() => void loadMarketplace(true), 10000);
    return () => clearInterval(interval);
  }, [loadMarketplace]);

  useEffect(() => {
    const ticker = setInterval(() => {
      setLiveYield((prev) => {
        const amplitude = Math.max(0.01, Math.abs(metrics.contractYieldPerHour) * 0.004);
        const drift = (Math.random() - 0.5) * amplitude;
        return Number((prev + drift).toFixed(4));
      });
    }, 1800);

    return () => clearInterval(ticker);
  }, [metrics.contractYieldPerHour]);

  const yieldTrend = useMemo(() => (liveYield >= 0 ? "up" : "down"), [liveYield]);

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <h2 className="font-display text-3xl font-black uppercase tracking-tight md:text-4xl">Collaboration</h2>
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
            Digital Labor Marketplace
          </p>
        </div>
        <button
          onClick={() => void loadMarketplace(true)}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200"
        >
          {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <MetricTile label="Listed Assets" value={String(metrics.listedCount)} icon={Workflow} />
        <MetricTile label="Rented Assets" value={String(metrics.rentedCount)} icon={Coins} />
        <MetricTile
          label="Avg Autonomy"
          value={metrics.averageAutonomy.toFixed(3)}
          icon={ArrowUpRight}
        />
        <div className={`rounded-2xl border px-3 py-3 ${themeStyle.border} bg-black/30`}>
          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Contract Yield</p>
          <div className="mt-2 flex items-center gap-2">
            <p className="text-2xl font-bold text-slate-100">{liveYield.toFixed(4)}</p>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${
                yieldTrend === "up"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-red-500/40 bg-red-500/10 text-red-300"
              }`}
            >
              {yieldTrend === "up" ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              / hr
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 2xl:grid-cols-2">
        <AssetPanel
          title="Listed Assets"
          subtitle="Available for external contracts"
          assets={listedAssets}
          loading={loading}
          themeStyle={themeStyle}
          onAssetClick={(asset) =>
            notify({
              title: "Marketplace Insight",
              message: `${asset.name} dynamic rate ${asset.dynamicRate.toFixed(4)} (${asset.pricingModel ?? "N/A"}).`,
              type: "info"
            })
          }
        />
        <AssetPanel
          title="Rented Assets"
          subtitle="Currently contracted labor"
          assets={rentedAssets}
          loading={loading}
          themeStyle={themeStyle}
          onAssetClick={(asset) =>
            notify({
              title: "Contract Snapshot",
              message: `${asset.name} yield contribution tracked at ${asset.dynamicRate.toFixed(4)}.`,
              type: "info"
            })
          }
        />
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  icon: Icon
}: {
  label: string;
  value: string;
  icon: ComponentType<{ size?: string | number; className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-3">
      <div className="flex items-center gap-2">
        <Icon size={15} className="text-slate-400" />
        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-100">{value}</p>
    </div>
  );
}

function AssetPanel({
  title,
  subtitle,
  assets,
  loading,
  themeStyle,
  onAssetClick
}: {
  title: string;
  subtitle: string;
  assets: MarketAsset[];
  loading: boolean;
  themeStyle: { accent: string; accentSoft: string; border: string };
  onAssetClick: (asset: MarketAsset) => void;
}) {
  return (
    <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">{title}</p>
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{subtitle}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] ${themeStyle.accentSoft}`}>
          {assets.length}
        </span>
      </div>

      {loading ? (
        <div className="inline-flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={14} className="animate-spin" />
          Loading assets...
        </div>
      ) : assets.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-xs uppercase tracking-[0.16em] text-slate-500">
          No assets in this lane.
        </p>
      ) : (
        <div className="space-y-3">
          {assets.map((asset) => (
            <button
              key={asset.id}
              onClick={() => onAssetClick(asset)}
              className="w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-left transition hover:border-white/20"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-100">
                    {asset.name} <span className="text-slate-500">({asset.type})</span>
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    {asset.role} | {asset.status}
                  </p>
                </div>
                <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-cyan-300">
                  Autonomy {asset.autonomyScore.toFixed(2)}
                </span>
              </div>
              <div className="mt-2 grid gap-2 text-[10px] uppercase tracking-[0.14em] text-slate-400 md:grid-cols-3">
                <span>Base {asset.baseRate.toFixed(4)}</span>
                <span>Dynamic {asset.dynamicRate.toFixed(4)}</span>
                <span>Model {asset.pricingModel ?? "NONE"}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
