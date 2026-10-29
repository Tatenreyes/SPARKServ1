"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import { APPLIANCES } from "@/lib/appliances";

/*
 * The gallery is derived from the same `APPLIANCES` catalogue the repair
 * request wizard uses. "Other" is excluded because it is a fallback choice,
 * not an appliance category. Existing `image` values are used as-is; entries
 * without an uploaded photo render a branded placeholder instead of a broken
 * <img> or an invented path.
 */
const GALLERY_ITEMS = APPLIANCES.filter((appliance) => appliance.value !== "other");

const GALLERY_DESCRIPTIONS: Record<string, string> = {
  refrigerator: "Cooling, defrosting, and temperature problems.",
  aircon: "Cooling, airflow, and water-leak concerns.",
  washing_machine: "Draining, spinning, and water-leak problems.",
  tv: "Power, display, and sound concerns.",
  electric_fan: "Power, speed, and unusual-noise concerns.",
  microwave: "Heating, power, and turntable concerns.",
  rice_cooker: "Heating and cooking-performance concerns.",
  electric_stove: "Heating-element and control concerns.",
  induction_cooker: "Power and heating concerns.",
  water_dispenser: "Dispensing, cooling, and heating concerns.",
  electric_kettle: "Heating and power concerns.",
  vacuum_cleaner: "Suction, power, and blockage concerns.",
  clothes_dryer: "Heating, tumbling, and drying concerns.",
  freezer: "Freezing and temperature concerns.",
  water_heater: "Heating and water-flow concerns.",
};

export default function ApplianceGallery() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [openedFrom, setOpenedFrom] = useState<number | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const slideButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const carouselIndexRef = useRef(0);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const reduceMotion = useReducedMotion() ?? false;

  const isOpen = activeIndex !== null;
  const currentItem = activeIndex !== null ? GALLERY_ITEMS[activeIndex] : null;
  const originItem = openedFrom !== null ? GALLERY_ITEMS[openedFrom] : null;
  const currentIndex = activeIndex ?? 0;
  carouselIndexRef.current = carouselIndex;

  const close = useCallback(() => setActiveIndex(null), []);

  const navigate = useCallback((direction: 1 | -1) => {
    setActiveIndex((index) => {
      if (index === null) return index;
      return (index + direction + GALLERY_ITEMS.length) % GALLERY_ITEMS.length;
    });
  }, []);

  const open = useCallback((index: number, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setOpenedFrom(index);
    setActiveIndex(index);
  }, []);

  const scrollToSlide = useCallback(
    (index: number, behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth") => {
      const container = carouselRef.current;
      const slide = slideRefs.current[index];
      if (!container || !slide) return;

      const left = slide.offsetLeft;
      container.scrollTo({ left, behavior });
      setCarouselIndex(index);
    },
    [reduceMotion]
  );

  const goToCarouselIndex = useCallback(
    (index: number, moveFocus = false) => {
      const next = Math.max(0, Math.min(index, GALLERY_ITEMS.length - 1));
      scrollToSlide(next);
      if (moveFocus) {
        slideButtonRefs.current[next]?.focus({ preventScroll: true });
      }
    },
    [scrollToSlide]
  );

  /* Keep the carousel in step with lightbox navigation, and keep the current
     card centred when the viewport is resized. */
  useEffect(() => {
    if (activeIndex !== null) {
      scrollToSlide(activeIndex);
    }
  }, [activeIndex, scrollToSlide]);

  useEffect(() => {
    function handleResize() {
      const container = carouselRef.current;
      const slide = slideRefs.current[carouselIndexRef.current];
      if (!container || !slide) return;
      container.scrollTo({ left: slide.offsetLeft, behavior: "auto" });
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleCarouselScroll = useCallback(() => {
    const container = carouselRef.current;
    if (!container) return;

    const anchor = container.scrollLeft + 1;
    let closest = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    slideRefs.current.forEach((slide, index) => {
      if (!slide) return;
      const distance = Math.abs(slide.offsetLeft - anchor);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = index;
      }
    });

    setCarouselIndex(closest);
  }, []);

  /* Sync the active card with the initial scroll position, including a
     browser-restored position after a refresh. */
  useEffect(() => {
    handleCarouselScroll();
  }, [handleCarouselScroll]);

  /* Sync from native scroll events as well as programmatic navigation. */
  useEffect(() => {
    const container = carouselRef.current;
    if (!container) return;

    const onScroll = () => handleCarouselScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [handleCarouselScroll]);

  /* Desktop mouse-wheel support: scrolling over the rail moves the cards
     horizontally. At either end the event is released so the page can scroll
     normally instead of trapping the wheel. */
  useEffect(() => {
    const container = carouselRef.current;
    if (!container) return;
    const scroller: HTMLDivElement = container;

    function handleWheel(event: WheelEvent) {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;

      const maxScroll = scroller.scrollWidth - scroller.clientWidth;
      if (event.deltaY < 0 && scroller.scrollLeft <= 0) return;
      if (event.deltaY > 0 && scroller.scrollLeft >= maxScroll - 1) return;

      event.preventDefault();
      const target = Math.max(0, Math.min(maxScroll, scroller.scrollLeft + event.deltaY));
      scroller.scrollLeft = target;

      const cardWidth = slideRefs.current[0]?.offsetWidth ?? 1;
      const nextIndex = Math.max(0, Math.min(GALLERY_ITEMS.length - 1, Math.round(target / cardWidth)));
      setCarouselIndex(nextIndex);
    }

    scroller.addEventListener("wheel", handleWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", handleWheel);
  }, []);

  function handleCarouselKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goToCarouselIndex(carouselIndex + 1, true);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goToCarouselIndex(carouselIndex - 1, true);
    }
  }

  function handleCarouselPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    suppressClickRef.current = false;
  }

  function handleCarouselPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const start = pointerStartRef.current;
    if (!start) return;

    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
      suppressClickRef.current = true;
    }
  }

  function handleCarouselPointerEnd() {
    pointerStartRef.current = null;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }
  /* Escape closes, arrows browse, and Tab is trapped inside the dialog. The
     listener lives on the document so the shortcuts work regardless of which
     control inside the dialog currently owns focus. */
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        navigate(1);
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigate(-1);
        return;
      }

      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close, isOpen, navigate]);

  /* Lock background scrolling and move focus into the dialog. On close, put
     focus back on the card that opened it. The scrollbar compensation stops
     the page underneath from shifting sideways when overflow is hidden. */
  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;

    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 40);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      (triggerRef.current ?? previouslyFocused)?.focus({ preventScroll: true });
    };
  }, [isOpen]);

  function handleTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleTouchEnd(event: React.TouchEvent) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (Math.abs(deltaX) > 55 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
      navigate(deltaX < 0 ? 1 : -1);
    }
  }

  return (
    <section id="supported-appliances" className="border-y border-white/10 bg-[#070D12]">
      <div className="spark-section py-8 md:py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#81EDF4]">Supported Appliances</p>
            <h2 className="mt-1.5 text-2xl font-bold text-white sm:text-3xl">A closer look at what we repair</h2>
            <p className="mt-1.5 text-sm leading-6 text-white/65">
              Scroll or use the arrows to browse. Select an appliance to view it larger.
            </p>
          </div>
          <Link
            href="/services"
            className="group inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-full border border-[#81EDF4]/30 bg-white/5 px-5 text-sm font-semibold text-white transition-colors duration-200 hover:border-[#81EDF4] hover:bg-white/10 sm:w-auto"
          >
            View all services
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>

        <div className="relative mt-5">
            <div
              ref={carouselRef}
              id="appliance-carousel"
              className="appliance-carousel"
              role="region"
              aria-roledescription="carousel"
              aria-label="Supported appliance images"
              onKeyDown={handleCarouselKeyDown}
              onPointerDown={handleCarouselPointerDown}
              onPointerMove={handleCarouselPointerMove}
              onPointerUp={handleCarouselPointerEnd}
              onPointerCancel={handleCarouselPointerEnd}
              onPointerLeave={handleCarouselPointerEnd}
            >
              {GALLERY_ITEMS.map((item, index) => (
                <div
                  key={item.value}
                  ref={(node) => {
                    slideRefs.current[index] = node;
                  }}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${index + 1} of ${GALLERY_ITEMS.length}: ${item.label}`}
                  className={`appliance-slide ${carouselIndex === index ? "is-active" : ""}`}
                >
                  <button
                    ref={(node) => {
                      slideButtonRefs.current[index] = node;
                    }}
                    type="button"
                    onClick={(event) => {
                      if (suppressClickRef.current) return;
                      open(index, event.currentTarget);
                    }}
                    aria-haspopup="dialog"
                    aria-label={`Open a larger image of ${item.label}`}
                    className="group flex w-full flex-col items-center rounded-[1.4rem] text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81EDF4] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070D12]"
                  >
                    <div className="appliance-slide-media relative aspect-square w-full overflow-hidden rounded-[1.1rem] bg-[radial-gradient(circle_at_50%_35%,#182333_0%,#0B1118_72%)] shadow-[0_10px_22px_-12px_rgba(0,0,0,0.7)] ring-1 ring-white/10">
                      {item.image ? (
                        <Image
                          src={item.image}
                          alt={`${item.label} appliance`}
                          fill
                          loading="lazy"
                          quality={90}
                          sizes="(min-width: 1024px) 220px, (min-width: 640px) 200px, 168px"
                          className="object-contain p-3 transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                        />
                      ) : (
                        <AppliancePlaceholder item={item} />
                      )}
                      <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/15 opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
                        <Expand className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    </div>

                    <h3 className="appliance-slide-title mt-3 text-sm font-semibold leading-tight text-white sm:text-[15px]">
                      {item.label}
                    </h3>
                  </button>
                </div>
              ))}

              <div className="appliance-carousel-end-spacer" aria-hidden="true" />
            </div>

            <button
              type="button"
              onClick={() => goToCarouselIndex(carouselIndex - 1)}
              disabled={carouselIndex === 0}
              aria-label="Previous appliance"
              className="absolute left-1 top-[40%] z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-[#6D70F0] text-white shadow-[0_10px_24px_-8px_rgba(5,11,24,0.6)] transition duration-200 hover:scale-105 hover:bg-[#8587FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81EDF4] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070D12] disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:scale-100 disabled:hover:bg-[#6D70F0] sm:flex"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => goToCarouselIndex(carouselIndex + 1)}
              disabled={carouselIndex === GALLERY_ITEMS.length - 1}
              aria-label="Next appliance"
              className="absolute right-1 top-[40%] z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-[#6D70F0] text-white shadow-[0_10px_24px_-8px_rgba(5,11,24,0.6)] transition duration-200 hover:scale-105 hover:bg-[#8587FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81EDF4] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070D12] disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:scale-100 disabled:hover:bg-[#6D70F0] sm:flex"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="mt-3 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => goToCarouselIndex(carouselIndex - 1)}
                disabled={carouselIndex === 0}
                aria-label="Previous appliance"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition-colors duration-200 hover:border-[#81EDF4] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81EDF4] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070D12] disabled:cursor-not-allowed disabled:opacity-25 sm:hidden"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>

              <div
                role="group"
                aria-label="Choose appliance slide"
                className="flex max-w-[min(100%,22rem)] flex-wrap items-center justify-center gap-1.5"
              >
                {GALLERY_ITEMS.map((item, index) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => goToCarouselIndex(index)}
                    aria-label={`Show ${item.label}`}
                    aria-current={carouselIndex === index ? "true" : undefined}
                    className={`h-2 rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81EDF4] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070D12] ${
                      carouselIndex === index ? "w-5 bg-[#81EDF4]" : "w-2 bg-white/25 hover:bg-[#81EDF4]"
                    }`}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={() => goToCarouselIndex(carouselIndex + 1)}
                disabled={carouselIndex === GALLERY_ITEMS.length - 1}
                aria-label="Next appliance"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition-colors duration-200 hover:border-[#81EDF4] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81EDF4] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070D12] disabled:cursor-not-allowed disabled:opacity-25 sm:hidden"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <p aria-live="polite" className="sr-only">
              Showing {GALLERY_ITEMS[carouselIndex].label}, appliance {carouselIndex + 1} of {GALLERY_ITEMS.length}.
            </p>

          </div>

          <AnimatePresence>
            {isOpen && currentItem && originItem && (
              <motion.div
                key="appliance-lightbox"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.2 }}
                className="fixed inset-0 z-[100] flex items-center justify-center px-3 sm:px-6"
                style={{
                  paddingTop: "max(0.75rem, env(safe-area-inset-top))",
                  paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
                }}
              >
                <div
                  aria-hidden="true"
                  onClick={close}
                  className="absolute inset-0 bg-[#070D12]/90 backdrop-blur-sm"
                />

                <motion.div
                  ref={panelRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="appliance-lightbox-title"
                  aria-describedby="appliance-lightbox-description"
                  tabIndex={-1}
                  className="relative z-10 flex max-h-full w-full max-w-4xl flex-col overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[#070D12] text-white shadow-[0_30px_90px_-20px_rgba(5,11,24,0.75)]"
                >
                  <div className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-6 sm:py-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#81EDF4]">Supported appliance</p>
                      <h2 id="appliance-lightbox-title" className="mt-1 text-lg font-bold leading-tight text-white sm:text-xl">
                        {currentItem.label}
                      </h2>
                    </div>
                    <button
                      ref={closeButtonRef}
                      type="button"
                      onClick={close}
                      aria-label="Close appliance gallery"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/65 transition-colors duration-200 hover:border-[#81EDF4] hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81EDF4] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070D12]"
                    >
                      <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </div>

                  <div
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                    className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-[radial-gradient(circle_at_50%_45%,#182333_0%,#070D12_75%)] sm:aspect-[16/10]"
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={currentItem.value}
                        initial={{ opacity: 0, scale: reduceMotion ? 1 : 1.015 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.99 }}
                        transition={{ duration: reduceMotion ? 0 : 0.18 }}
                        className="absolute inset-0"
                      >
                        {currentItem.image ? (
                          <Image
                            src={currentItem.image}
                            alt={`${currentItem.label} appliance`}
                            fill
                            loading="eager"
                            quality={92}
                            sizes="(min-width: 896px) 896px, 100vw"
                            className="object-contain p-2 sm:p-4"
                          />
                        ) : (
                          <AppliancePlaceholder item={currentItem} large />
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </div>

                  <div className="flex flex-col gap-3 border-t border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
                    <p id="appliance-lightbox-description" className="max-w-xl text-sm leading-6 text-white/65">
                      {GALLERY_DESCRIPTIONS[currentItem.value] ?? "Appliance repair support from SPARKServ."}
                    </p>

                    <div className="flex items-center justify-between gap-2 sm:justify-end">
                      <button
                        type="button"
                        onClick={() => navigate(-1)}
                        aria-label={`Previous appliance: ${
                          GALLERY_ITEMS[(currentIndex - 1 + GALLERY_ITEMS.length) % GALLERY_ITEMS.length].label
                        }`}
                        className="inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-full border border-white/15 px-3 text-xs font-semibold text-white transition-colors duration-200 hover:border-[#81EDF4] hover:bg-white/10 sm:px-4"
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                        <span className="hidden sm:inline">Previous</span>
                      </button>

                      <span className="min-w-14 text-center text-xs font-semibold tabular-nums text-white/50" aria-hidden="true">
                        {currentIndex + 1} / {GALLERY_ITEMS.length}
                      </span>

                      <button
                        type="button"
                        onClick={() => navigate(1)}
                        aria-label={`Next appliance: ${
                          GALLERY_ITEMS[(currentIndex + 1) % GALLERY_ITEMS.length].label
                        }`}
                        className="inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-full border border-white/15 px-3 text-xs font-semibold text-white transition-colors duration-200 hover:border-[#81EDF4] hover:bg-white/10 sm:px-4"
                      >
                        <span className="hidden sm:inline">Next</span>
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <p aria-live="polite" className="sr-only">
                    Showing {currentItem.label}, appliance {currentIndex + 1} of {GALLERY_ITEMS.length}.
                  </p>
                </motion.div>

              </motion.div>
            )}
          </AnimatePresence>
      </div>
    </section>
  );
}

function AppliancePlaceholder({
  item,
  large = false,
}: {
  item: (typeof GALLERY_ITEMS)[number];
  large?: boolean;
}) {
  const Icon = item.icon;

  return (
    <div
      role="img"
      aria-label={`${item.label} image coming soon`}
      className={`absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_32%,#182333_0%,#070D12_72%)] text-white ${
        large ? "gap-4" : "gap-2"
      }`}
    >
      <span
        className={`flex items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-[#81EDF4] ${
          large ? "h-20 w-20" : "h-12 w-12"
        }`}
      >
        <Icon className={large ? "h-10 w-10" : "h-6 w-6"} aria-hidden="true" />
      </span>
      <span
        className={`font-semibold uppercase tracking-[0.14em] text-white/55 ${
          large ? "text-[11px]" : "text-[8px]"
        }`}
      >
        Photo coming soon
      </span>
    </div>
  );
}
