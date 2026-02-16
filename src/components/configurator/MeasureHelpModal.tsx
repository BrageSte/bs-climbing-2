import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import DepthGuide from './DepthGuide'
import { Lightbulb, Ruler, ArrowUpDown, ArrowRight } from 'lucide-react'

interface MeasureHelpModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function MeasureHelpModal({ open, onOpenChange }: MeasureHelpModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Slik måler du fingrene</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Følg denne guiden for å finne riktige mål til din crimp-blokk
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Tips før du måler - fremhevet øverst */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Lightbulb className="w-5 h-5 text-amber-500" />
              <h4 className="font-semibold text-amber-500 text-sm uppercase tracking-wide">
                TIPS FØR DU MÅLER
              </h4>
            </div>
            <ul className="text-sm text-foreground space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-amber-500 mt-0.5">•</span>
                <span>Mål på <strong>venstre hånd</strong> (ikke høyre).</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 mt-0.5">•</span>
                <span>Bruk <strong>skyvelære</strong> for best presisjon. Funker bra med linjal/tommestokk.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 mt-0.5">•</span>
                <span>Klem fingeren lett ned mot en kant (bordkant eller en vanlig crimp) når du måler. Fingerputen utvider seg litt under trykk – det er den bredden du vil ha.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 mt-0.5">•</span>
                <span>Litt ekstra margin er bedre enn for tight.</span>
              </li>
            </ul>
          </div>

          <div className="space-y-4">
            {/* 1) Fingerbredde */}
            <section className="bg-surface-light/40 border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <span className="w-7 h-7 bg-primary rounded-full flex items-center justify-center text-primary-foreground text-sm font-bold">1</span>
                <Ruler className="w-4 h-4 text-primary" />
                <h3 className="font-medium text-foreground">Fingerbredde (mm)</h3>
              </div>
              <div className="pl-10 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Mål bredden på fingeren ytterst på fingerputen (der fingeren treffer kanten).
                </p>
                <p className="text-sm text-muted-foreground">
                  Legg til <strong className="text-foreground">2 mm totalt</strong> (1 mm på hver side) for litt margin.
                </p>

                <div className="bg-surface-light border border-border rounded-lg p-3 flex items-center justify-center gap-3">
                  <span className="text-sm text-muted-foreground">Eksempel:</span>
                  <span className="font-mono text-foreground font-medium">18 mm</span>
                  <ArrowRight className="w-4 h-4 text-primary" />
                  <span className="font-mono text-primary font-bold">20 mm</span>
                </div>

                <figure className="bg-surface-light border border-border rounded-lg p-3">
                  <img
                    src="/images/measure-help/finger-width.jpg"
                    alt="Måling av fingerbredde med skyvelære"
                    className="w-full rounded-md"
                    loading="lazy"
                  />
                  <figcaption className="mt-2 text-xs text-muted-foreground text-center">
                    Eksempel på hvordan du måler fingerbredde.
                  </figcaption>
                </figure>
              </div>
            </section>

            {/* 2) Høydeforskjell */}
            <section className="bg-surface-light/40 border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <span className="w-7 h-7 bg-primary rounded-full flex items-center justify-center text-primary-foreground text-sm font-bold">2</span>
                <ArrowUpDown className="w-4 h-4 text-primary" />
                <h3 className="font-medium text-foreground">Høydeforskjell (mm)</h3>
              </div>
              <div className="pl-10 space-y-3">
                <p className="text-sm text-muted-foreground">
                  <strong className="text-foreground">Lillefinger</strong> er alltid utgangspunktet (fast baseline på 10mm).
                </p>
                <p className="text-sm text-muted-foreground">
                  Du legger inn hvor mye <strong className="text-foreground">neste finger er høyere</strong> enn den forrige.
                </p>
                <figure className="bg-surface-light border border-border rounded-lg p-3">
                  <img
                    src="/images/measure-help/height-differences.jpg"
                    alt="Illustrasjon av høydeforskjeller mellom fingrene"
                    className="w-full rounded-lg"
                    loading="lazy"
                  />
                  <figcaption className="mt-2 text-xs text-muted-foreground text-center">
                    Illustrasjon av høydeforskjeller mellom fingrene.
                  </figcaption>
                </figure>
              </div>
            </section>

            {/* 3) Dybde */}
            <section className="bg-surface-light/40 border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <span className="w-7 h-7 bg-primary rounded-full flex items-center justify-center text-primary-foreground text-sm font-bold">3</span>
                <ArrowRight className="w-4 h-4 text-primary rotate-90" />
                <h3 className="font-medium text-foreground">Dybde</h3>
              </div>
              <div className="pl-10 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Dette styrer hvor mye "hud" som får plass på kanten.
                </p>
                <div className="bg-surface-light border border-border rounded-lg p-4">
                  <DepthGuide />
                </div>
                <p className="text-sm text-muted-foreground">
                  <strong className="text-foreground">Usikker?</strong> Velg 20 mm – det passer de fleste.
                </p>
              </div>
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
