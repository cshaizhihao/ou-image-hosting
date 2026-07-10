import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import clsx from "clsx";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode
} from "react";

export function cn(...values: Array<string | false | null | undefined>) {
  return clsx(values);
}

const buttonVariants = cva("ou-button", {
  variants: {
    variant: {
      primary: "ou-button--primary",
      secondary: "ou-button--secondary",
      ghost: "ou-button--ghost",
      danger: "ou-button--danger"
    },
    size: {
      default: "ou-button--default",
      compact: "ou-button--compact",
      icon: "ou-button--icon"
    }
  },
  defaultVariants: {
    variant: "primary",
    size: "default"
  }
});

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({
  asChild,
  className,
  variant,
  size,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "info";
}) {
  return (
    <span className={cn("ou-badge", `ou-badge--${tone}`, className)} {...props}>
      {children}
    </span>
  );
}

export function Progress({
  value,
  label
}: {
  value: number;
  label: string;
}) {
  const safeValue = Math.min(100, Math.max(0, value));
  return (
    <div className="ou-progress" aria-label={label}>
      <div className="ou-progress__track">
        <div className="ou-progress__value" style={{ width: `${safeValue}%` }} />
      </div>
      <span>{safeValue}%</span>
    </div>
  );
}
