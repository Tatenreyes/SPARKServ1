"use client";

import { motion } from "motion/react";
import { Refrigerator, WashingMachine, Wind } from "lucide-react";

interface LoadingScreenProps {
  message?: string;
}

export default function LoadingScreen({ message = "Please wait..." }: LoadingScreenProps) {
  return (
    <div className="fixed inset-0 z-[100] flex min-h-screen items-center justify-center bg-brand-900/95 px-6 text-white backdrop-blur-sm">
      <div className="flex flex-col items-center text-center">
        <div className="relative flex h-28 w-28 items-center justify-center">
          <div className="absolute inset-1 rounded-full border-2 border-brand-300/30" />
          <motion.div
            className="absolute inset-1 rounded-full border-2 border-transparent border-t-spark-300 border-r-spark-300"
            animate={{ rotate: 360 }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
          />
          <motion.div
            className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-spark-400 text-brand-900 shadow-lg"
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
          >
            <motion.div
              className="flex items-end gap-1.5"
              animate={{ x: [-3, 3, -3] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            >
              <motion.div
                animate={{ y: [0, -5, 0], rotate: [-4, 4, -4] }}
                transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
              >
                <Refrigerator className="h-9 w-9" strokeWidth={2.5} />
              </motion.div>
              <motion.div
                animate={{ y: [-2, 3, -2], rotate: [3, -3, 3] }}
                transition={{ duration: 1.25, repeat: Infinity, ease: "easeInOut" }}
              >
                <WashingMachine className="h-9 w-9" strokeWidth={2.5} />
              </motion.div>
              <motion.div
                animate={{ y: [0, -4, 0] }}
                transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
              >
                <Wind className="h-8 w-8" strokeWidth={2.5} />
              </motion.div>
            </motion.div>
          </motion.div>
        </div>
        <div className="mt-5 flex items-center gap-1.5" role="status" aria-live="polite">
          <span className="h-1.5 w-8 overflow-hidden rounded-full bg-white/20"><span className="block h-full w-1/2 animate-pulse rounded-full bg-spark-300" /></span>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-spark-300 [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-spark-300 [animation-delay:300ms]" />
        </div>
        <p className="mt-4 text-sm font-medium text-white/80">{message}</p>
      </div>
    </div>
  );
}