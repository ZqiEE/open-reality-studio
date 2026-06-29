'use client';

import { useMemo, useState } from 'react';
import type { Locale } from '@/lib/i18n';
import {
  getAllRealityAssets,
  getImportedRealityAssets,
  parseRealityAssetJson,
  validateRealityAssetPackage,
  type AssetImportResult,
  type RealityAssetPackage
} from '@/lib/reality-assets';

const copy = {
  en: {
    title: 'Reality Asset Catalog',
    subtitle: 'Device ecosystem packages',
    capabilities: 'capabilities',
    adapter: 'adapter',
    safety: 'safety',
    prompt: 'example',
    validation: 'validation',
    source: 'source',
    importJson: 'Import JSON',
    pasteJson: 'Paste Reality Asset JSON here',
    realDisabled: 'real disabled',
    noHardware: 'no hardware execution',
    valid: 'valid',
    invalid: 'invalid'
  },
  zh: {
    title: 'Reality Asset Catalog',
    subtitle: 'Device ecosystem packages',
    capabilities: 'capabilities',
    adapter: 'adapter',
    safety: 'safety',
    prompt: 'example',
    validation: 'validation',
    source: 'source',
    importJson: 'Import JSON',
    pasteJson: 'Paste Reality Asset JSON here',
    realDisabled: 'real disabled',
    noHardware: 'no hardware execution',
    valid: 'valid',
    invalid: 'invalid'
  }
};

const supportClassName: Record<RealityAssetPackage['supportLevel'], string> = {
  simulation_only: 'border-[#064E3B] bg-[#10251D] text-[#34D399]',
  read_only: 'border-[#075985] bg-[#0B2233] text-[#38BDF8]',
  coming_soon: 'border-[#3F3F46] bg-[#24262B] text-[#A1A1AA]',
  unsupported: 'border-[#4C1D1D] bg-[#25191B] text-[#FCA5A5]'
};

function supportLabel(supportLevel: RealityAssetPackage['supportLevel']) {
  if (supportLevel === 'simulation_only') return 'Simulation';
  if (supportLevel === 'read_only') return 'Read Only';
  if (supportLevel === 'coming_soon') return 'Coming Soon';
  return 'Unsupported';
}

function adapterMode(asset: RealityAssetPackage) {
  if (asset.adapterBoundary.adapterMode === 'read_only') return 'read-only';
  if (asset.adapterBoundary.adapterMode === 'simulation_only') return 'simulation';
  return 'inspect only';
}

export function RealityAssetCatalog({
  assets,
  language,
  selectedAssetId
}: {
  assets: RealityAssetPackage[];
  language: Locale;
  selectedAssetId?: string | null;
}) {
  const text = copy[language];
  const [draft, setDraft] = useState('');
  const [importResult, setImportResult] = useState<AssetImportResult | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const catalogAssets = useMemo(() => {
    void refreshToken;
    return getAllRealityAssets();
  }, [assets, refreshToken]);
  const importedIds = useMemo(() => {
    void refreshToken;
    return new Set(getImportedRealityAssets().map((asset) => asset.assetId));
  }, [refreshToken]);

  function importDraft() {
    const result = parseRealityAssetJson(draft);
    setImportResult(result);
    if (result.status === 'imported') {
      setDraft('');
      setRefreshToken((value) => value + 1);
    }
  }

  return (
    <section className="border-t border-border-panel bg-[#17191D]">
      <div className="flex h-8 items-center justify-between border-b border-border-panel px-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted-strong">{text.title}</div>
          <div className="text-[10px] text-text-muted">{text.subtitle}</div>
        </div>
        <span className="rounded-[3px] border border-[#3F3F46] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-muted">
          {text.realDisabled}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2 border-b border-border-panel px-3 py-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={text.pasteJson}
          className="h-12 resize-none border border-border-panel bg-[#111214] px-2 py-1 font-mono text-[10px] text-text-primary outline-none focus:border-[#0284C7]"
        />
        <button
          type="button"
          onClick={importDraft}
          disabled={!draft.trim()}
          className="h-12 rounded-[3px] border border-[#075985] bg-[#0B2233] px-3 text-[11px] font-semibold text-[#38BDF8] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {text.importJson}
        </button>
        {importResult && (
          <div className={`col-span-2 border px-2 py-1 text-[10px] ${importResult.status === 'imported' ? 'border-[#064E3B] bg-[#10251D] text-[#34D399]' : 'border-[#7F1D1D] bg-[#2B1116] text-[#FCA5A5]'}`}>
            {importResult.status.toUpperCase()}: {importResult.userFacingMessage}
            {importResult.errors.length > 0 && <span className="ml-2 font-mono">{importResult.errors[0]}</span>}
          </div>
        )}
      </div>
      <div className="custom-scrollbar flex max-h-[132px] gap-2 overflow-x-auto px-3 py-2">
        {catalogAssets.map((asset) => {
          const selected = asset.assetId === selectedAssetId;
          const prompt = asset.examplePrompts.supported[0] ?? asset.examplePrompts.unsupported[0] ?? '';
          const validation = validateRealityAssetPackage(asset);
          const source = importedIds.has(asset.assetId) ? 'imported' : 'builtin';
          return (
            <article
              key={asset.assetId}
              className={`min-w-[220px] border bg-[#1E1F22] p-2 ${selected ? 'border-[#0284C7]' : 'border-border-panel'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-semibold text-text-primary">{asset.name}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-text-muted">{asset.deviceType}</div>
                </div>
                <span className={`shrink-0 rounded-[3px] border px-1.5 py-0.5 text-[9px] font-semibold ${supportClassName[asset.supportLevel]}`}>
                  {supportLabel(asset.supportLevel)}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 text-[10px]">
                <span className="uppercase tracking-wide text-text-muted">{text.capabilities}</span>
                <span className="font-mono text-text-primary">{asset.capabilityContracts.length}</span>
                <span className="uppercase tracking-wide text-text-muted">{text.adapter}</span>
                <span className="truncate font-mono text-text-primary">{adapterMode(asset)}</span>
                <span className="uppercase tracking-wide text-text-muted">{text.safety}</span>
                <span className="truncate font-mono text-text-primary">{text.noHardware}</span>
                <span className="uppercase tracking-wide text-text-muted">{text.validation}</span>
                <span className={validation.valid ? 'font-mono text-[#34D399]' : 'font-mono text-[#FCA5A5]'}>
                  {validation.valid ? text.valid : text.invalid}
                </span>
                <span className="uppercase tracking-wide text-text-muted">{text.source}</span>
                <span className="font-mono text-text-primary">{source}</span>
                <span className="uppercase tracking-wide text-text-muted">{text.prompt}</span>
                <span className="truncate font-mono text-text-secondary" title={prompt}>{prompt || '-'}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
