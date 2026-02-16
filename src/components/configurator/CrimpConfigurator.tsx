import { useState, useMemo } from "react";
import OrderModal from "./OrderModal";
import StlViewer, { type BlockVariant } from "./StlViewer";
import BlockSelector, { DEFAULT_BLOCK_OPTIONS } from "./BlockSelector";
import DynamicBlockPreview from "./DynamicBlockPreview";
import MeasureHelpModal from "./MeasureHelpModal";
import HeightValidationDialog from "./HeightValidationDialog";
import MeasureHelpPopover from "./MeasureHelpPopover";
import { HelpCircle, ShoppingBag, Download, Info } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { useCart } from "@/contexts/CartContext";
import { Product, generateProductId, BlockConfig } from "@/types/shop";
import { useToast } from "@/hooks/use-toast";
import { NumberStepper } from "@/components/ui/number-stepper";
import { useSettings } from "@/hooks/useSettings";

const FINGER_NAMES = ["lillefinger", "ringfinger", "langfinger", "pekefinger"] as const;
type FingerName = (typeof FINGER_NAMES)[number];

interface Widths {
  lillefinger: number;
  ringfinger: number;
  langfinger: number;
  pekefinger: number;
}

interface HeightDiffs {
  lilleToRing: number;
  ringToLang: number;
  langToPeke: number;
}

export default function CrimpConfigurator() {
  const { addToCart } = useCart();
  const { toast } = useToast();
  const { data: settings } = useSettings();
  const [blockVariant, setBlockVariant] = useState<BlockVariant>("shortedge");

  const [widths, setWidths] = useState<Widths>({
    lillefinger: 21,
    ringfinger: 20,
    langfinger: 20,
    pekefinger: 22,
  });

  const [heightDiffs, setHeightDiffs] = useState<HeightDiffs>({
    lilleToRing: 5,
    ringToLang: 5,
    langToPeke: -3,
  });

  const lilleHeight = 10;

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

  const depth = 20;
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [orderType, setOrderType] = useState<"file" | "printed" | null>(null);
  const [orderSent, setOrderSent] = useState(false);
  const [showMeasureHelp, setShowMeasureHelp] = useState(false);

  const [validationDialog, setValidationDialog] = useState<{
    open: boolean;
    heightDiffName: string;
    value: number;
    pendingValue: number;
    heightKey: keyof HeightDiffs;
  } | null>(null);

  const totalWidth = useMemo(() => {
    const fingerWidths = Object.values(widths).reduce((sum, w) => sum + w, 0);
    return fingerWidths + 16;
  }, [widths]);

  const safeProducts = useMemo(
    () =>
      (settings?.products ?? []).filter(
        (product) =>
          (product.variant === "shortedge" || product.variant === "longedge") &&
          typeof product.name === "string" &&
          Number.isFinite(product.price)
      ),
    [settings?.products]
  );

  const blockOptions = safeProducts.length
    ? safeProducts.map((p) => ({ variant: p.variant, name: p.name, price: p.price }))
    : DEFAULT_BLOCK_OPTIONS;
  const currentPrice = blockOptions.find((o) => o.variant === blockVariant)?.price ?? 399;
  const filePrice = settings?.stl_file_price ?? 199;

  const handleHeightChange = (heightKey: keyof HeightDiffs, value: number) => {
    if (Math.abs(value) > 30) {
      // Show warning dialog
      const heightLabels: Record<keyof HeightDiffs, string> = {
        lilleToRing: "Lille → ring",
        ringToLang: "Ring → lang",
        langToPeke: "Lang → peke"
      };

      setValidationDialog({
        open: true,
        heightDiffName: heightLabels[heightKey],
        value: value,
        pendingValue: value,
        heightKey: heightKey
      });
    } else {
      // Direct update for values <= 30mm absolute value
      setHeightDiffs((prev) => ({ ...prev, [heightKey]: value }));
    }
  };

  const confirmHeightChange = () => {
    if (validationDialog) {
      setHeightDiffs((prev) => ({
        ...prev,
        [validationDialog.heightKey]: validationDialog.pendingValue
      }));
    }
  };

  const createBlockConfig = (): BlockConfig => ({
    blockVariant,
    widths,
    heights: calculatedHeights,
    depth,
    totalWidth,
  });

  const handleAddToCart = (type: "file" | "printed") => {
    const config = createBlockConfig();
    const productId = generateProductId(config, type);

    const product: Product = {
      id: productId,
      name:
        type === "file"
          ? `3D-fil – ${blockVariant === "shortedge" ? "Compact" : "Long Edge"}`
          : `Ferdig printet – Stepper ${blockVariant === "shortedge" ? "Compact" : "Long Edge"}`,
      description: `Tilpasset crimp block: ${totalWidth.toFixed(1)}mm bred × ${depth}mm dyp`,
      price: type === "file" ? filePrice : currentPrice,
      variant: blockVariant === "shortedge" ? "Compact" : "Long Edge",
      isDigital: type === "file",
      config,
    };

    addToCart(product, 1);

    toast({
      title: "Lagt i handlekurven!",
      description: product.name,
    });
  };

  const generateOrder = (type: "file" | "printed") => {
    setOrderType(type);
    setShowOrderForm(true);
  };

  const handleOrderComplete = () => {
    setOrderSent(true);
    setShowOrderForm(false);
  };

  const handleReset = () => {
    setOrderSent(false);
    setShowOrderForm(false);
  };

  if (orderSent) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="bg-card border border-border rounded-2xl p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-valid/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-valid" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-2">Bestilling sendt!</h2>
          <p className="text-muted-foreground mb-6">Send e-posten for å fullføre bestillingen.</p>
          <button
            onClick={handleReset}
            className="px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary-hover transition-colors"
          >
            Ny konfigurasjon
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* STEP 1: Velg produkt */}
      <section className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <span className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-primary-foreground font-bold text-sm">
            1
          </span>
          <h2 className="text-lg font-semibold text-foreground">Velg produkt</h2>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Block type selector */}
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Blokktype</h3>
            <BlockSelector selected={blockVariant} onChange={setBlockVariant} products={safeProducts} />
          </div>

          {/* 3D Preview - STL Model */}
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              3D Forhåndsvisning
            </h3>
            <StlViewer variant={blockVariant} />
          </div>
        </div>
      </section>

      {/* STEP 2: Dine mål */}
      <section className="bg-card border border-border rounded-2xl p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-primary-foreground font-bold text-sm">
            2
          </span>
          <h2 className="text-lg font-semibold text-foreground">Dine mål</h2>
          <button
            onClick={() => setShowMeasureHelp(true)}
            className="ml-auto flex items-center gap-2 text-sm text-primary hover:text-primary-hover transition-colors"
          >
            <HelpCircle className="w-4 h-4" />
            <span className="hidden sm:inline">Måleguide</span>
          </button>
        </div>
        <button
          onClick={() => setShowMeasureHelp(true)}
          className="mt-3 mb-4 sm:mt-4 sm:mb-6 w-full flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-surface-light px-3 py-2.5 sm:px-4 sm:py-3 text-left transition-colors hover:border-primary/60 hover:bg-primary/10"
        >
          <span className="flex items-center gap-2 sm:gap-3">
            <span className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
              <HelpCircle className="w-4 h-4" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-foreground">Målehjelp</span>
              <span className="block text-xs text-muted-foreground">
                Se bilder og tips for å måle riktig.
              </span>
            </span>
          </span>
          <span className="text-xs font-semibold text-primary">Åpne</span>
        </button>

        {/* Inputs */}
        <div className="space-y-4 sm:space-y-6">
          {/* Finger widths */}
          <div>
            <div className="flex items-center gap-1.5 mb-2 sm:mb-3">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Fingerbredde (mm)
              </h3>
              <MeasureHelpPopover section="fingerbredde" />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground mb-3 leading-relaxed">
              Mål på venstre hånd, ytterst på fingerpaden. +2mm for komfort.
            </p>
            <div className="grid grid-cols-4 gap-2 sm:gap-3">
              {(["Lille", "Ring", "Lang", "Peke"] as const).map((label, i) => {
                const finger = FINGER_NAMES[i];
                return (
                  <div key={finger} className="flex flex-col items-center">
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 text-center">{label}</label>
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
          </div>

          {/* Height differences */}
          <div>
            <div className="flex items-center gap-1.5 mb-2 sm:mb-3">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Høydeforskjell (mm)
              </h3>
              <MeasureHelpPopover section="hoydeforskjell" />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground mb-3 leading-relaxed">
              Mål på venstre hånd. Justerer stegene for halvcrimpgrep.
            </p>
            <div className="space-y-2 sm:space-y-3">
              {([
                { key: 'lilleToRing' as const, label: 'Lille → Ring', badge: 'A', resultFinger: 'ringfinger' as const },
                { key: 'ringToLang' as const, label: 'Ring → Lang', badge: 'B', resultFinger: 'langfinger' as const },
                { key: 'langToPeke' as const, label: 'Lang → Peke', badge: 'C', resultFinger: 'pekefinger' as const },
              ]).map(({ key, label, badge, resultFinger }) => (
                <div key={key} className="flex items-center gap-1.5 sm:gap-3">
                  <span className="w-5 h-5 sm:w-6 sm:h-6 bg-primary/20 border border-primary/40 rounded text-primary text-[10px] sm:text-xs flex items-center justify-center font-semibold shrink-0">
                    {badge}
                  </span>
                  <span className="text-foreground text-xs sm:text-sm shrink-0">{label}</span>
                  <NumberStepper
                    value={heightDiffs[key]}
                    onChange={(val) => handleHeightChange(key, val)}
                    min={-40}
                    max={40}
                    size="sm"
                    className="flex-1 min-w-0"
                  />
                  <span className="text-muted-foreground text-xs w-10 sm:w-14 text-right font-mono shrink-0">
                    {calculatedHeights[resultFinger]}mm
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-2 opacity-75">Lillefinger: fast 10mm</p>
          </div>

          {/* Depth info */}
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 sm:mb-3">Dybde</h3>
            <p className="text-sm text-muted-foreground">
              Optimal dybde og avrunding for behagelig grep.
            </p>
          </div>
        </div>

        {/* Preview - always below inputs on mobile, side-by-side on lg+ */}
        <div className="mt-4 sm:mt-6">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 sm:mb-3">
            Forhåndsvisning
          </h3>
          <DynamicBlockPreview widths={widths} heights={calculatedHeights} heightDiffs={heightDiffs} depth={depth} />
          <p className="text-[10px] sm:text-xs text-muted-foreground text-center mt-2 opacity-75">
            Roter for å se fra ulike vinkler
          </p>
        </div>
      </section>

      {/* STEP 3: Bestill */}
      <section className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <span className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-primary-foreground font-bold text-sm">
            3
          </span>
          <h2 className="text-lg font-semibold text-foreground">Bestill</h2>
        </div>

        {/* Summary */}
        <div className="bg-surface-light rounded-xl p-4 mb-6">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground text-xs block mb-1">Blokktype</span>
              <span className="text-foreground font-medium">
                {blockVariant === "shortedge" ? "Compact" : "Long Edge"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground text-xs block mb-1">Dybde</span>
              <span className="text-foreground font-mono font-medium">{depth}mm</span>
            </div>
            <div>
              <span className="text-muted-foreground text-xs block mb-1">Farge</span>
              <span className="text-foreground font-medium">Svart</span>
            </div>
            <div>
              <span className="text-muted-foreground text-xs block mb-1">Materiale</span>
              <span className="text-foreground font-medium">PLA+</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-border">
            <span className="text-muted-foreground text-xs block mb-1.5">Fingermål</span>
            <div className="flex gap-3 text-xs font-mono text-foreground">
              <span>P: {widths.pekefinger}×{heightDiffs.langToPeke}({calculatedHeights.pekefinger})</span>
              <span>L: {widths.langfinger}×{heightDiffs.ringToLang}({calculatedHeights.langfinger})</span>
              <span>R: {widths.ringfinger}×{heightDiffs.lilleToRing}({calculatedHeights.ringfinger})</span>
              <span>Li: {widths.lillefinger}({calculatedHeights.lillefinger})</span>
            </div>
          </div>
        </div>

        {/* Order buttons */}
        <div className="space-y-3">
          {/* Primary: Ferdig printet */}
          <button
            onClick={() => handleAddToCart("printed")}
            className="w-full p-6 bg-valid/5 border-2 border-valid/40 rounded-xl transition-all hover:border-valid hover:shadow-lg text-center group relative"
          >
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-valid text-white text-[11px] font-semibold px-3 py-0.5 rounded-full">
              Anbefalt
            </span>
            <ShoppingBag className="w-6 h-6 mx-auto mb-2 text-valid" />
            <div className="text-foreground font-semibold text-base mb-1">Kjøp ferdig printet</div>
            <div className="text-xs text-muted-foreground mb-3">Sendes hjem eller hentes – normalt innen 1 uke</div>
            <div className="text-2xl font-bold text-valid">{currentPrice},-</div>
          </button>

          {/* Secondary: Digital fil */}
          <TooltipProvider>
            <button
              onClick={() => handleAddToCart("file")}
              className="w-full p-4 bg-surface-light border border-border rounded-xl transition-all hover:border-primary/50 text-center group"
            >
              <div className="flex items-center justify-center gap-2 mb-1">
                <Download className="w-4 h-4 text-primary" />
                <span className="text-foreground font-medium text-sm">Kjøp 3D-print-fil (print selv)</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted-foreground/20 text-muted-foreground cursor-help"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Info className="w-3 h-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[250px] text-center">
                    STL/3D-print-fil: Dette er en digital fil for 3D-printer. Ikke et fysisk produkt.
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="text-[11px] text-muted-foreground mb-2">
                For deg som har egen 3D-printer. Du får en fil du kan printe hjemme.
              </div>
              <div className="text-lg font-bold text-primary">{filePrice},-</div>
            </button>
          </TooltipProvider>
        </div>
      </section>

      {/* Order Modal */}
      {showOrderForm && orderType && (
        <OrderModal
          orderType={orderType}
          blockVariant={blockVariant}
          widths={widths}
          calculatedHeights={calculatedHeights}
          heightDiffs={heightDiffs}
          depth={depth}
          totalWidth={totalWidth}
          onClose={() => setShowOrderForm(false)}
          onComplete={handleOrderComplete}
        />
      )}

      {/* Measure Help Modal */}
      <MeasureHelpModal open={showMeasureHelp} onOpenChange={setShowMeasureHelp} />

      {/* Height Validation Dialog */}
      {validationDialog && (
        <HeightValidationDialog
          open={validationDialog.open}
          onOpenChange={(open) => !open && setValidationDialog(null)}
          heightDiffName={validationDialog.heightDiffName}
          value={validationDialog.value}
          onConfirm={confirmHeightChange}
        />
      )}
    </div>
  );
}
