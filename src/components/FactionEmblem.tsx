// Emblème de faction (monogramme sur un dégradé de sa teinte) : Réputation et Reprendre ma partie.
export function FactionEmblem({ mono, hue, size = "md" }: { mono: string; hue: string; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-16 w-16 rounded-[18px] text-lg" : "h-[42px] w-[42px] rounded-xl text-[13px]";
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center font-extrabold tracking-wide text-white ${box}`}
      style={{
        background: `linear-gradient(150deg, color-mix(in oklab, ${hue} 55%, transparent), color-mix(in oklab, ${hue} 12%, transparent))`,
        border: `1px solid color-mix(in oklab, ${hue} 50%, transparent)`,
      }}
    >
      {mono}
    </span>
  );
}
