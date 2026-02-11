import { lazy, Suspense } from 'react'
import Header from '@/components/Header'
import ProductHero from '@/components/landing/ProductHero'

// Lazy-load below-the-fold sections to speed up initial paint
const WhyCustom = lazy(() => import('@/components/landing/WhyCustom'))
const HowItWorks = lazy(() => import('@/components/landing/HowItWorks'))
const WhatYouGet = lazy(() => import('@/components/landing/WhatYouGet'))
const Delivery = lazy(() => import('@/components/landing/Delivery'))
const FAQ = lazy(() => import('@/components/landing/FAQ'))
const CTASection = lazy(() => import('@/components/landing/CTASection'))
const Footer = lazy(() => import('@/components/Footer'))

export default function Index() {
  return (
    <>
      <Header />
      <main>
        <ProductHero />
        <Suspense>
          <WhyCustom />
          <HowItWorks />
          <WhatYouGet />
          <Delivery />
          <FAQ />
          <CTASection />
        </Suspense>
      </main>
      <Suspense>
        <Footer />
      </Suspense>
    </>
  )
}
