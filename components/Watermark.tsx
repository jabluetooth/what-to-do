/**
 * Decorative "WHAT TO DO?" background text — purely cosmetic, so it's not part of the a11y tree.
 * Breaks out of its column to span the full viewport width (left-1/2 + -translate-x-1/2 +
 * w-screen), clipped only vertically by its own overflow-hidden. The nearest positioned ancestor
 * must NOT have overflow-hidden of its own, or it clips the breakout right back down to that
 * ancestor's own (narrow) width — every call site is placed outside any such wrapper. Font-size
 * scales with viewport width (clamp) so the text reaches from edge to edge at any screen size.
 * Height is fixed (relative to that same font-size, via inheritance) with leading-none on the
 * text — a transform-based crop doesn't work here: a transform repaints pixels without changing
 * the box overflow-hidden measures against, and default line-height pads well beyond the glyphs,
 * so nothing visible actually gets cut that way. A taller window (0.92em, cropping only the very
 * base of the glyphs) than the mask's own fade zone means the fade has real room to play out
 * gradually before it reaches that crop line, instead of both happening over the same short span
 * and reading as one abrupt edge.
 *
 * Needs a `relative` ancestor to pin against (via `absolute bottom-0`) and a sibling wrapped in
 * `relative z-10` to render above it — an absolutely-positioned `z-0` element still paints above
 * plain in-flow siblings in the same stacking context otherwise.
 */
export default function Watermark() {
  return (
    <div
      className="pointer-events-none absolute bottom-0 left-1/2 z-0 w-screen -translate-x-1/2 overflow-hidden"
      style={{ height: "0.92em", fontSize: "clamp(3rem, 14vw, 18rem)" }}
    >
      <p
        aria-hidden="true"
        className="select-none whitespace-nowrap text-center font-extrabold leading-none tracking-tighter text-neutral-900/[0.05] dark:text-white/[0.045] blur-[2px]"
        style={{
          maskImage: "linear-gradient(to bottom, black 0%, black 15%, transparent 95%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 15%, transparent 95%)",
        }}
      >
        WHAT TO DO?
      </p>
    </div>
  );
}
