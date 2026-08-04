import type { ButtonHTMLAttributes } from "react";

type StableLabelButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Label shown on the button. */
  label: string;
  /** All labels this button may show; width is reserved for the longest. */
  widthLabels?: string[];
};

/**
 * Button whose width stays fixed when `label` swaps (e.g. Manage → Loading…).
 */
export function StableLabelButton({
  label,
  widthLabels,
  className,
  type = "button",
  ...props
}: StableLabelButtonProps) {
  const measure = Array.from(new Set(widthLabels?.length ? widthLabels : [label]));
  const hidden = measure.filter((text) => text !== label);

  return (
    <button
      type={type}
      className={`btn btn-stable-label${className ? ` ${className}` : ""}`}
      {...props}
    >
      <span className="btn-stable-label-stack">
        <span className="btn-stable-label-visible">{label}</span>
        {hidden.map((text) => (
          <span key={text} className="btn-stable-label-measure" aria-hidden="true">
            {text}
          </span>
        ))}
      </span>
    </button>
  );
}
