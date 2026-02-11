import { useState, useEffect, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X, ShoppingBag } from 'lucide-react'
import { useCart } from '@/contexts/CartContext'

const CartDrawer = lazy(() => import('@/components/cart/CartDrawer'))

export default function Header() {
  const { itemCount, isCartOpen, setIsCartOpen } = useCart()
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false)
  }

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 overflow-hidden transition-all duration-300 ${
        isScrolled
          ? 'bg-background/95 backdrop-blur-md border-b border-border'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <nav className="flex items-center justify-between h-16">
          {/* Logo - Clean text only like Hand of God */}
          <Link to="/" className="font-semibold text-lg tracking-wide text-foreground hover:text-primary transition-colors">
            BS CLIMBING
          </Link>

          {/* Desktop Navigation - Minimal */}
          <div className="hidden md:flex items-center gap-8">
            <Link 
              to="/#how-it-works"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Hvordan
            </Link>
            <Link 
              to="/#faq"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              FAQ
            </Link>
            <Link 
              to="/configure" 
              className="text-sm font-medium text-foreground hover:text-primary transition-colors"
            >
              Konfigurer
            </Link>
            
            {/* Cart button */}
            <button
              onClick={() => setIsCartOpen(true)}
              className="relative p-2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Åpne handlekurv"
            >
              <ShoppingBag className="w-5 h-5" />
              {itemCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary text-primary-foreground text-xs font-bold rounded-full flex items-center justify-center">
                  {itemCount > 9 ? '9+' : itemCount}
                </span>
              )}
            </button>
          </div>

          {/* Mobile: Cart + Menu */}
          <div className="md:hidden flex items-center gap-2">
            <button
              onClick={() => setIsCartOpen(true)}
              className="relative p-2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Åpne handlekurv"
            >
              <ShoppingBag className="w-5 h-5" />
              {itemCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary text-primary-foreground text-xs font-bold rounded-full flex items-center justify-center">
                  {itemCount > 9 ? '9+' : itemCount}
                </span>
              )}
            </button>
            <button 
              className="p-2 text-muted-foreground hover:text-foreground"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </nav>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden py-6 border-t border-border bg-background animate-fade-in">
            <div className="flex flex-col gap-4">
              <Link 
                to="/#how-it-works"
                onClick={closeMobileMenu}
                className="text-muted-foreground hover:text-foreground transition-colors py-2"
              >
                Hvordan
              </Link>
              <Link 
                to="/#faq"
                onClick={closeMobileMenu}
                className="text-muted-foreground hover:text-foreground transition-colors py-2"
              >
                FAQ
              </Link>
              <Link 
                to="/configure" 
                className="text-foreground font-medium py-2"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Konfigurer
              </Link>
            </div>
          </div>
        )}
      </div>
      
      {/* Cart Drawer */}
      {isCartOpen && (
        <Suspense fallback={null}>
          <CartDrawer />
        </Suspense>
      )}
    </header>
  )
}
