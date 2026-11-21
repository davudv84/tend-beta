"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { ComponentProps, ReactNode } from "react";
import { useReducedMotionPref } from "../scope";
import { variants, stagger } from "./tokens";

/** Content reveal: fades up once when it enters the viewport. Opacity only under reduced motion. */
export function Reveal({
  children,
  delay = 0,
  className,
  as = "div",
  ...rest
}: { children: ReactNode; delay?: number; className?: string; as?: "div" | "li" | "section" } & Omit<ComponentProps<typeof motion.div>, "children" | "className" | "variants">) {
  const reduced = useReducedMotionPref();
  const Comp = motion[as] as typeof motion.div;
  return (
    <Comp
      className={className}
      variants={reduced ? variants.revealReduced : variants.reveal}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ delay }}
      {...rest}
    >
      {children}
    </Comp>
  );
}

/** Staggers its direct `Reveal`-like children. */
export const staggerContainer = (reduced: boolean) => ({
  hidden: {},
  shown: { transition: { staggerChildren: reduced ? 0 : stagger.base } },
});

/** Page transition: wrap a route's content; `routeKey` changes when the route does. */
export function PageTransition({ routeKey, children, className }: { routeKey: string; children: ReactNode; className?: string }) {
  const reduced = useReducedMotionPref();
  const v = reduced ? variants.pageReduced : variants.page;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={routeKey} className={className} variants={v} initial="initial" animate="animate" exit="exit">
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
