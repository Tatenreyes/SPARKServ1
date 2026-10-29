import Image from "next/image";

/** Width ÷ height of the cropped SparkServ lockup. */
const LOGO_ASPECT = 1063 / 543;

/**
 * The SparkServ mark is wider than it is tall, so `size` is its rendered
 * height and the width follows the source aspect ratio.
 *
 * `auto` swaps between the navy-friendly white cutout and the navy-ink cutout
 * with the app theme. Landing-page chrome is always navy, so it uses `light`
 * explicitly instead of relying on the theme class.
 */
export default function BrandLogo({
  size = 32,
  variant = "auto",
  className = "",
}: {
  size?: number;
  variant?: "light" | "dark" | "auto";
  className?: string;
}) {
  const width = Math.round(size * LOGO_ASPECT);
  const imageClass = "h-full w-auto object-contain";

  return (
    <span
      className={`inline-flex shrink-0 select-none items-center ${className}`}
      style={{ width, height: size }}
    >
      {variant !== "dark" && (
        <Image
          src="/images/sparkserv-logo-light.png"
          alt="SPARKServ"
          width={width}
          height={size}
          className={`${imageClass} ${variant === "auto" ? "hidden dark:block" : ""}`}
          priority
        />
      )}
      {variant !== "light" && (
        <Image
          src="/images/sparkserv-logo-dark.png"
          alt="SPARKServ"
          width={width}
          height={size}
          className={`${imageClass} ${variant === "auto" ? "dark:hidden" : ""}`}
          priority
        />
      )}
    </span>
  );
}
