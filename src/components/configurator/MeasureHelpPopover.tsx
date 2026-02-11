import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { HelpCircle, Ruler, ArrowUpDown, ArrowRight } from 'lucide-react'

interface MeasureHelpPopoverProps {
  section: 'fingerbredde' | 'hoydeforskjell'
}

export default function MeasureHelpPopover({ section }: MeasureHelpPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center w-4 h-4 rounded-full text-muted-foreground hover:text-primary transition-colors"
          aria-label={`Hjelp: ${section === 'fingerbredde' ? 'fingerbredde' : 'høydeforskjell'}`}
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className="w-72 sm:w-80 p-0 bg-card border-border max-h-[60vh] overflow-y-auto"
      >
        {section === 'fingerbredde' ? <FingerbreddeHelp /> : <HoydeforskjellHelp />}
      </PopoverContent>
    </Popover>
  )
}

function FingerbreddeHelp() {
  return (
    <div className="p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Ruler className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
          Fingerbredde
        </span>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Mål bredden ytterst på fingerputen der den treffer kanten.
        Legg til <strong className="text-foreground">2 mm</strong> (1 mm hver side) for margin.
      </p>

      <div className="flex items-center justify-center gap-2 bg-surface-light border border-border rounded-md px-2 py-1.5 text-xs">
        <span className="text-muted-foreground">Eks:</span>
        <span className="font-mono text-foreground">18 mm</span>
        <ArrowRight className="w-3 h-3 text-primary" />
        <span className="font-mono text-primary font-bold">20 mm</span>
      </div>

      <img
        src="/images/measure-help/finger-width.jpg"
        alt="Måling av fingerbredde med skyvelære"
        className="w-full max-h-32 object-cover rounded-md border border-border"
        loading="lazy"
      />
    </div>
  )
}

function HoydeforskjellHelp() {
  return (
    <div className="p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <ArrowUpDown className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
          Høydeforskjell
        </span>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        <strong className="text-foreground">Lillefinger</strong> er baseline (fast 10 mm).
        Angi hvor mye neste finger er høyere enn den forrige.
      </p>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Usikker? La standardverdiene stå.
      </p>

      <img
        src="/images/measure-help/height-differences.jpg"
        alt="Illustrasjon av høydeforskjeller mellom fingrene"
        className="w-full max-h-36 object-contain rounded-md border border-border"
        loading="lazy"
      />
    </div>
  )
}
