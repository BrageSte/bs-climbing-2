import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useLandingPrices } from "@/hooks/useLandingPrices";

export default function ProductHero() {
  const { data: landingPrices } = useLandingPrices();
  const stlPrice = landingPrices.stlFilePrice;
  const printedPrice = landingPrices.printedFromPrice;
  return (
    <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden bg-background">
      {/* Subtle background gradient */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/3 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-5xl mx-auto px-4 sm:px-6 py-16 md:py-24">
        {/* Mobile: stacked, Desktop: side by side */}
        <div className="flex flex-col lg:grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* Text content — visible immediately for fast LCP (no opacity animation) */}
          <div
            className="text-center lg:text-left order-2 lg:order-1"
          >
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-4 text-foreground">
              Stepper
              <span className="block text-muted-foreground font-medium text-xl sm:text-2xl lg:text-3xl mt-2">
                – bygget etter hver finger
              </span>
            </h1>

            <p className="text-base sm:text-lg text-muted-foreground max-w-lg mx-auto lg:mx-0 leading-relaxed">
              Crimpblokker finnes overalt. Dette er Stepper: Du taster inn fingerhøydene dine, og vi lager en custom
              Stepper som passer perfekt til din hånd.
            </p>

            <p className="text-base sm:text-lg text-foreground/90 font-medium mt-4 mb-8 max-w-lg mx-auto lg:mx-0 leading-relaxed">
              Jevnere drag. Mer rekruttering. Råere fingerstyrke.
            </p>

            {/* CTA Button */}
            <Link
              to="/configure"
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-foreground text-background font-medium rounded-lg hover:bg-foreground/90 transition-all group"
            >
              Kjøp Stepper
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Link>

            {/* Price badges */}
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3">
              <span className="inline-flex items-center gap-1.5 bg-surface border border-border px-4 py-2 rounded-full text-sm">
                STL-fil fra{" "}
                <span className="inline-block min-w-[6ch] text-right font-bold text-foreground tabular-nums">
                  {stlPrice},-
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 bg-valid/10 border border-valid/20 px-4 py-2 rounded-full text-sm text-valid">
                Ferdig printet fra{" "}
                <span className="inline-block min-w-[6ch] text-right font-bold tabular-nums">
                  {printedPrice},-
                </span>
              </span>
            </div>

            <p className="text-xs text-muted-foreground mt-4">Henting i Oslo · Frakt i hele Norge</p>
          </div>

          {/* Product Visual */}
          <div
            className="relative order-1 lg:order-2 w-full max-w-sm lg:max-w-md mx-auto animate-fade-in"
          >
            <div className="relative aspect-square">
              {/* Product image placeholder */}
              <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/80 rounded-2xl overflow-hidden">
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/50 text-xs uppercase tracking-[0.2em]">
                  Produktbilde kommer
                </div>

                {/* Crimp block visualization */}
                <div className="absolute inset-0 flex items-end justify-center pb-10">
                  <div className="flex items-end gap-1.5">
                    {[
                      { h: "40%", w: "w-10 sm:w-12" },
                      { h: "52%", w: "w-10 sm:w-12" },
                      { h: "60%", w: "w-10 sm:w-12" },
                      { h: "48%", w: "w-10 sm:w-12" },
                    ].map((block, i) => (
                      <div
                        key={i}
                        className={`${block.w} bg-gradient-to-t from-muted-foreground/40 to-muted-foreground/25 rounded-t-sm`}
                        style={{ height: block.h }}
                      />
                    ))}
                  </div>
                </div>

                {/* Base */}
                <div className="absolute bottom-0 inset-x-0 h-5 bg-muted-foreground/30" />

                {/* Subtle highlight */}
                <div className="absolute top-0 left-0 right-0 h-1/4 bg-gradient-to-b from-background/10 to-transparent" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
