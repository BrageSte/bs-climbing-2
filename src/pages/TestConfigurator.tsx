import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ParametricBlockPreview from "@/components/configurator/ParametricBlockPreview";
import type { BlockVariant } from "@/components/configurator/StlViewer";
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
  const depth = 20;

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

  return (
    <>
      <Header />
      <main className="min-h-screen bg-background pt-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Link
            to="/configure"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Tilbake til konfigurator</span>
          </Link>

          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight mb-2">
              Test: Ny STL-konfigurator
            </h1>
            <p className="text-sm text-muted-foreground">
              Parametrisk 3D-forhåndsvisning med trappet profil og avrundede kanter.
            </p>
          </div>

          <div className="space-y-6">
            {/* Variant toggle */}
            <section className="bg-card border border-border rounded-xl p-4">
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Blokktype
              </h2>
              <div className="flex gap-2">
                {(["shortedge", "longedge"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setBlockVariant(v)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
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
            <section className="bg-card border border-border rounded-xl p-4">
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Fingerbredde (mm)
              </h2>
              <div className="grid grid-cols-4 gap-2">
                {(["Lille", "Ring", "Lang", "Peke"] as const).map((label, i) => {
                  const finger = (["lillefinger", "ringfinger", "langfinger", "pekefinger"] as const)[i];
                  return (
                    <div key={finger} className="flex flex-col items-center">
                      <label className="text-xs font-medium text-muted-foreground mb-1.5">{label}</label>
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
            <section className="bg-card border border-border rounded-xl p-4">
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Høydeforskjell (mm)
              </h2>
              <div className="space-y-2">
                {([
                  { key: "lilleToRing" as const, label: "Lille \u2192 Ring", badge: "A", resultFinger: "ringfinger" as const },
                  { key: "ringToLang" as const, label: "Ring \u2192 Lang", badge: "B", resultFinger: "langfinger" as const },
                  { key: "langToPeke" as const, label: "Lang \u2192 Peke", badge: "C", resultFinger: "pekefinger" as const },
                ]).map(({ key, label, badge, resultFinger }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-5 h-5 bg-primary/20 border border-primary/40 rounded text-primary text-[10px] flex items-center justify-center font-semibold shrink-0">
                      {badge}
                    </span>
                    <span className="text-foreground text-xs shrink-0">{label}</span>
                    <NumberStepper
                      value={heightDiffs[key]}
                      onChange={(val) => setHeightDiffs((prev) => ({ ...prev, [key]: val }))}
                      min={-40}
                      max={40}
                      size="sm"
                      className="flex-1 min-w-0"
                    />
                    <span className="text-muted-foreground text-xs w-12 text-right font-mono shrink-0">
                      {calculatedHeights[resultFinger]}mm
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 opacity-75">Lillefinger: fast 10mm</p>
            </section>

            {/* 3D Preview */}
            <section className="bg-card border border-border rounded-xl p-4">
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Forhåndsvisning
              </h2>
              <ParametricBlockPreview
                widths={widths}
                heights={calculatedHeights}
                depth={depth}
                blockVariant={blockVariant}
              />
              <p className="text-[10px] text-muted-foreground text-center mt-2 opacity-75">
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
