import { motion } from "framer-motion";
import { DEFAULT_PRODUCTS, DEFAULT_STL_FILE_PRICE } from "@/lib/siteDefaults";

export default function WhatYouGet() {
  const stlPrice = DEFAULT_STL_FILE_PRICE;
  const printedPrices = DEFAULT_PRODUCTS
    .map((product) => (Number.isFinite(product.price) ? product.price : null))
    .filter((price): price is number => price !== null);
  const printedPrice = printedPrices.length > 0 ? Math.min(...printedPrices) : 399;

  const deliverables = [
    {
      title: "STL-fil",
      price: `${stlPrice},-`,
      description: "Print-klar fil optimalisert for FDM-printing. Inkluderer anbefalte innstillinger.",
    },
    {
      title: "Ferdig printet fra",
      price: `${printedPrice},-`,
      description: "Vi printer og sender. Høykvalitets PLA+ med ±0.3mm toleranse.",
    },
  ];

  return (
    <section className="py-32 bg-background">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">VELG DITT FORMAT</h2>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6">
          {deliverables.map((item, index) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="border border-border p-8 hover:border-muted-foreground/50 transition-colors"
            >
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-xl font-semibold">{item.title}</h3>
                <span className="text-2xl font-bold font-mono">{item.price}</span>
              </div>
              <p className="text-muted-foreground text-sm">{item.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
