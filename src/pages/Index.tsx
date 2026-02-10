import Header from '@/components/Header'
import Footer from '@/components/Footer'
import ProductHero from '@/components/landing/ProductHero'
import WhyCustom from '@/components/landing/WhyCustom'
import HowItWorks from '@/components/landing/HowItWorks'
import WhatYouGet from '@/components/landing/WhatYouGet'
import Delivery from '@/components/landing/Delivery'
import FAQ from '@/components/landing/FAQ'
import CTASection from '@/components/landing/CTASection'

export default function Index() {
  return (
    <>
      <Header />
      <main>
        <ProductHero />
        <WhyCustom />
        <HowItWorks />
        <WhatYouGet />
        <Delivery />
        <FAQ />
        <CTASection />
      </main>
      <Footer />
    </>
  )
}
