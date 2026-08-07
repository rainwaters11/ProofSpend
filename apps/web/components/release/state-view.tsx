"use client";

import { AlertTriangle, CircleDollarSign, Inbox, Loader2, Settings, WifiOff } from "lucide-react";
import type { ReactNode } from "react";

import type { MoneyAmount } from "@proofspend/domain";

import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format-money";

interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label = "Loading…" }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center"
    >
      <Loader2 aria-hidden="true" className="size-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
      <Inbox aria-hidden="true" className="size-6 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "Something went wrong",
  description = "This screen could not load. Try again.",
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-6 py-16 text-center"
    >
      <AlertTriangle aria-hidden="true" className="size-6 text-destructive" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-destructive">{title}</p>
        <p className="text-sm text-destructive/80">{description}</p>
      </div>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

interface OfflineStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

/**
 * Blocks the user from proceeding (network/service unavailable), so this
 * is an alert, not a status — but must name the actual condition rather
 * than reuse ErrorState's generic "something went wrong" copy.
 */
export function OfflineState({
  title = "You're offline",
  description = "This screen needs a network connection to load. Check your connection and try again.",
  onRetry,
}: OfflineStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-6 py-16 text-center"
    >
      <WifiOff aria-hidden="true" className="size-6 text-destructive" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-destructive">{title}</p>
        <p className="text-sm text-destructive/80">{description}</p>
      </div>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

interface ConfigurationMissingStateProps {
  title?: string;
  description?: string;
  action?: ReactNode;
}

/**
 * "Not yet configured" is an expected interim state during Phase A/B, not a
 * fault — uses the warning tone (not destructive) so it doesn't read as an
 * error the user caused.
 */
export function ConfigurationMissingState({
  title = "Configuration needed",
  description = "This feature isn't configured yet. No mock or live data is available until it is.",
  action,
}: ConfigurationMissingStateProps) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-6 py-16 text-center"
    >
      <Settings aria-hidden="true" className="size-6 text-warning" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

interface InsufficientBalanceStateProps {
  available: MoneyAmount;
  required: MoneyAmount;
  description?: string;
}

/**
 * Presentation-only: derives its numbers from existing MoneyAmount props,
 * never a new domain enum. A blocked-pending-funding state is not a
 * failure of something attempted, so it uses the warning tone, matching
 * SUBMITTED's tone in lifecycle-callout.tsx.
 */
export function InsufficientBalanceState({
  available,
  required,
  description = "This mock scenario shows an insufficient balance — no funds are available to release.",
}: InsufficientBalanceStateProps) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-6 py-16 text-center"
    >
      <CircleDollarSign aria-hidden="true" className="size-6 text-warning" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">Insufficient balance</p>
        <p className="text-sm text-muted-foreground">{description}</p>
        <p className="text-sm text-muted-foreground">
          Available: {formatMoney(available)} · Required: {formatMoney(required)}
        </p>
      </div>
    </div>
  );
}
