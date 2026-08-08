"use client";

import { Bell, Menu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NAV_ITEMS } from "@/components/shell/nav-items";

const PRIMARY_MOBILE_ITEMS = NAV_ITEMS.slice(0, 4);

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label="Open navigation menu"
            className="flex size-11 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
          >
            <Menu aria-hidden="true" className="size-5" />
          </button>
        </SheetTrigger>
        <SheetContent side="left">
          <SheetHeader>
            <SheetTitle>ProofSpend LaunchVault</SheetTitle>
          </SheetHeader>

          <button
            type="button"
            aria-label="Proof gaps and notifications: none yet"
            className="flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Bell aria-hidden="true" className="size-5 shrink-0" />
            Notifications
          </button>

          <nav aria-label="Primary">
            <ul className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <item.icon aria-hidden="true" className="size-5 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </SheetContent>
      </Sheet>

      <nav
        aria-label="Quick navigation"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface md:hidden"
      >
        {PRIMARY_MOBILE_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex min-h-11 flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <item.icon aria-hidden="true" className="size-5" />
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
