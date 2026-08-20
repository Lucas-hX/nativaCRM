import Image from "next/image";
import { cn } from "@/lib/utils";

interface NativaMarkProps {
  className?: string;
  variant?: "on-dark" | "on-light";
  priority?: boolean;
}

/** Official closed logo block extracted from the approved brand manual. */
export function NativaMark({
  className,
  variant = "on-dark",
  priority = false,
}: NativaMarkProps) {
  return (
    <Image
      src={
        variant === "on-dark"
          ? "/brand/nativa-logo-dark.png"
          : "/brand/nativa-logo-light.png"
      }
      alt="Comunicación Nativa"
      width={967}
      height={577}
      priority={priority}
      className={cn("h-auto w-full", className)}
    />
  );
}
