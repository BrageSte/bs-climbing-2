import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import BlockViewer from "@/components/configurator/BlockViewer";
import ParametricBlockPreview from "@/components/configurator/ParametricBlockPreview";
import type { BlockVariant } from "@/components/configurator/StlViewer";
import { usePreviewModel } from "@/hooks/usePreviewModel";
import { NumberStepper } from "@/components/ui/number-stepper";

export default function TestConfigurator() {
  const [blockVariant, setBlockVariant] = useState<BlockVariant>("shortedge");

  const [widths, setWidths] = useState({
    lillefinger: 21,
    ringfinger: 20,
    langfinger: 20,
    pekefinger: 22,
  });

  const [heightDiffs, setHeightDiffs] = useState({
    lilleToRing: 5,
    ringToLang: 5,
    langToPeke: -3,
  });

  const lilleHeight = 10;
  const depth = 24;

  const calculatedHeights = useMemo(() => {
    const ring = lilleHeight + heightDiffs.lilleToRing;
    const lang = ring + heightDiffs.ringToLang;
    const peke = lang + heightDiffs.langToPeke;
    return {
      lillefinger: lilleHeight,
      ringfinger: ring,
      langfinger: lang,
      pekefinger: peke,
    };
  }, [heightDiffs]);

  // Debounced preview model hook — resolves STL URL from params
  const edgeMode = blockVariant === "longedge" ? 1 : 0;
  const previewParams = useMemo(
    () => ({ widths, heights: calculatedHeights, depth, edgeMode }),
    [widths, calculatedHeights, depth, edgeMode],
  );
  const { modelUrl, isGenerating, error: previewError, hash } = usePreviewModel(previewParams);

  return (
    <>
      <Header />
      <main className="min-h-screen bg-background pt-20">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
          <Link
            to="/configure"
            className="mb-8 inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm">Tilbake til konfigurator</span>
          </Link>

          <div className="mb-8">
            <h1 className="mb-2 text-2xl font-bold tracking-tight">
              Test: Ny STL-konfigurator
            </h1>
            <p className="text-sm text-muted-foreground">
              Fusion-lik 3D-forhåndsvisning med kanter, snitt og x-ray.
            </p>
          </div>

          <div className="space-y-6">
            {/* Variant toggle */}
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Blokktype
              </h2>
              <div className="flex gap-2">
                {(["shortedge", "longedge"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setBlockVariant(v)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                      blockVariant === v
                        ? "bg-primary text-primary-foreground"
                        : "bg-surface-light text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {v === "shortedge" ? "Compact" : "Long Edge"}
                  </button>
                ))}
              </div>
            </section>

            {/* Finger widths */}
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Fingerbredde (mm)
              </h2>
              <div className="grid grid-cols-4 gap-2">
                {(["Lille", "Ring", "Lang", "Peke"] as const).map((label, i) => {
                  const finger = (["lillefinger", "ringfinger", "langfinger", "pekefinger"] as const)[i];
                  return (
                    <div key={finger} className="flex flex-col items-center">
                      <label className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</label>
                      <NumberStepper
                        value={widths[finger]}
                        onChange={(val) => setWidths((prev) => ({ ...prev, [finger]: val }))}
                        min={15}
                        max={30}
                        size="sm"
                        className="w-full"
                      />
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Height diffs */}
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Høydeforskjell (mm)
              </h2>
              <div className="space-y-2">
                {([
                  { key: "lilleToRing" as const, label: "Lille \u2192 Ring", badge: "A", resultFinger: "ringfinger" as const },
                  { key: "ringToLang" as const, label: "Ring \u2192 Lang", badge: "B", resultFinger: "langfinger" as const },
                  { key: "langToPeke" as const, label: "Lang \u2192 Peke", badge: "C", resultFinger: "pekefinger" as const },
                ]).map(({ key, label, badge, resultFinger }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-primary/40 bg-primary/20 text-[10px] font-semibold text-primary">
                      {badge}
                    </span>
                    <span className="shrink-0 text-xs text-foreground">{label}</span>
                    <NumberStepper
                      value={heightDiffs[key]}
                      onChange={(val) => setHeightDiffs((prev) => ({ ...prev, [key]: val }))}
                      min={-40}
                      max={40}
                      size="sm"
                      className="min-w-0 flex-1"
                    />
                    <span className="w-12 shrink-0 text-right font-mono text-xs text-muted-foreground">
                      {calculatedHeights[resultFinger]}mm
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground opacity-75">Lillefinger: fast 10mm</p>
            </section>

            {/* ── STL Block Viewer (Fusion-stil) ────────────────────── */}
            <section className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  3D STL Viewer
                </h2>
                {isGenerating && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                    Oppdaterer 3D…
                  </span>
                )}
                {previewError && (
                  <span className="text-[10px] text-destructive">
                    Feil: {previewError}
                  </span>
                )}
              </div>

              <BlockViewer
                modelUrl={modelUrl}
                variant={blockVariant === "shortedge" ? "compact" : "long"}
                loadingText={isGenerating ? "Oppdaterer 3D\u2026" : undefined}
                configData={{
                  widths,
                  heights: calculatedHeights,
                  edgeMode,
                  depth,
                  modelId: hash?.slice(0, 8),
                }}
              />

              <p className="mt-2 text-center text-[10px] text-muted-foreground opacity-75">
                Roter / zoom / kamera-presets i toolbar under vieweren
              </p>
            </section>

            {/* ── Parametric Preview (sammenligning) ────────────────── */}
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Parametrisk forhåndsvisning (sammenligning)
              </h2>
              <ParametricBlockPreview
                widths={widths}
                heights={calculatedHeights}
                depth={depth}
                blockVariant={blockVariant}
              />
              <p className="mt-2 text-center text-[10px] text-muted-foreground opacity-75">
                Roter/zoom for å se fra ulike vinkler
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
