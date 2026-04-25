import * as React from "react";

import { cn } from "@/lib/utils";

interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
}

function Separator({ ref, className, orientation = "horizontal", ...props }: SeparatorProps & { ref?: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        className,
      )}
      ref={ref}
      role="separator"
      {...props}
    />
  );
}
Separator.displayName = "Separator";

export { Separator };
