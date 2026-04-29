import * as React from "react";

import { cn } from "@/lib/utils";

function ScrollArea({ ref, className, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { ref?: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div
      className={cn("relative overflow-auto overscroll-y-contain", className)}
      ref={ref}
      {...props}
    >
      {children}
    </div>
  );
}
ScrollArea.displayName = "ScrollArea";

export { ScrollArea };
