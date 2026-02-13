import { lazy, Suspense, useEffect } from 'react'
import Header from '@/components/Header'
import ProductHero from '@/components/landing/ProductHero'

const loadWhyCustom = () => import('@/components/landing/WhyCustom')
const loadHowItWorks = () => import('@/components/landing/HowItWorks')
const loadWhatYouGet = () => import('@/components/landing/WhatYouGet')
const loadDelivery = () => import('@/components/landing/Delivery')
const loadFAQ = () => import('@/components/landing/FAQ')
const loadCTASection = () => import('@/components/landing/CTASection')
const loadFooter = () => import('@/components/Footer')

const WhyCustom = lazy(loadWhyCustom)
const HowItWorks = lazy(loadHowItWorks)
const WhatYouGet = lazy(loadWhatYouGet)
const Delivery = lazy(loadDelivery)
const FAQ = lazy(loadFAQ)
const CTASection = lazy(loadCTASection)
const Footer = lazy(loadFooter)

const IDLE_PREFETCH_TIMEOUT_MS = 1200
const FALLBACK_PREFETCH_DELAY_MS = 500

const SectionFallback = ({ label }: { label: string }) => (
  <section className="py-24 bg-background">
    <div className="max-w-4xl mx-auto px-4 sm:px-6">
      <div className="h-7 w-44 rounded bg-surface-light/70" aria-hidden />
      <p className="mt-4 text-sm text-muted-foreground">Laster {label} ...</p>
    </div>
  </section>
)

const FooterFallback = () => (
  <div className="border-t border-border bg-background py-8">
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <p className="text-sm text-muted-foreground">Laster footer ...</p>
    </div>
  </div>
)

export default function Index() {
  useEffect(() => {
    const prefetchSections = () => {
      void loadWhyCustom()
      void loadHowItWorks()
      void loadWhatYouGet()
      void loadDelivery()
      void loadFAQ()
      void loadCTASection()
      void loadFooter()
    }

    const idleApi = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }

    if (typeof idleApi.requestIdleCallback === 'function') {
      const idleHandle = idleApi.requestIdleCallback(prefetchSections, {
        timeout: IDLE_PREFETCH_TIMEOUT_MS,
      })

      return () => {
        if (typeof idleApi.cancelIdleCallback === 'function') {
          idleApi.cancelIdleCallback(idleHandle)
        }
      }
    }

    const timeoutHandle = window.setTimeout(prefetchSections, FALLBACK_PREFETCH_DELAY_MS)
    return () => window.clearTimeout(timeoutHandle)
  }, [])

  return (
    <>
      <Header />
      <main>
        <ProductHero />
        <Suspense fallback={<SectionFallback label="fordeler" />}>
          <WhyCustom />
        </Suspense>
        <Suspense fallback={<SectionFallback label="hvordan det fungerer" />}>
          <HowItWorks />
        </Suspense>
        <Suspense fallback={<SectionFallback label="formatseksjonen" />}>
          <WhatYouGet />
        </Suspense>
        <Suspense fallback={<SectionFallback label="leveringsseksjonen" />}>
          <Delivery />
        </Suspense>
        <Suspense fallback={<SectionFallback label="FAQ" />}>
          <FAQ />
        </Suspense>
        <Suspense fallback={<SectionFallback label="neste steg" />}>
          <CTASection />
        </Suspense>
      </main>
      <Suspense fallback={<FooterFallback />}>
        <Footer />
      </Suspense>
    </>
  )
}
