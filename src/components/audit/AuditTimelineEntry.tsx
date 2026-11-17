import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AuditTimelineItem } from "@/hooks/useAuditHistory";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Hoje ${time}`;
  if (isYesterday) return `Ontem ${time}`;
  return `${date.toLocaleDateString("pt-BR")} ${time}`;
}

interface AuditTimelineEntryProps {
  item: AuditTimelineItem;
  /** Mostra a escola (usado no painel master, que mistura várias escolas). */
  schoolName?: string | null;
}

export function AuditTimelineEntry({ item, schoolName }: AuditTimelineEntryProps) {
  const { entry, log } = item;
  const isSupport = entry.actorBadge === "support" || entry.actorBadge === "master";

  return (
    <div
      className={cn(
        "flex gap-3 p-4 border-t first:border-t-0",
        isSupport && "bg-brand-accent/5",
      )}
    >
      <div
        className={cn(
          "h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
          isSupport ? "bg-brand-accent/15 text-brand-accent" : "bg-primary/10 text-primary",
        )}
      >
        {entry.actorBadge === "system" ? "•" : initials(entry.actorLabel)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <strong className="text-sm">{entry.actorLabel}</strong>
          {isSupport && (
            <Badge className="bg-brand-accent text-brand-accent-foreground hover:bg-brand-accent">
              {entry.actorBadge === "master" ? "Ação em escola de cliente" : "Ação do suporte"}
            </Badge>
          )}
          <Badge variant="secondary">{entry.categoryLabel}</Badge>
          {schoolName && <Badge variant="outline">{schoolName}</Badge>}
        </div>
        <p className="text-sm mt-1">{entry.summary}</p>
        {entry.diffs.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-sm">
            {entry.diffs.map((diff, i) => (
              <span key={i} className="text-muted-foreground">
                {diff.label}:{" "}
                <span className="bg-danger-light text-danger line-through rounded px-1">{diff.from}</span>
                {" → "}
                <span className="bg-success-light text-success rounded px-1">{diff.to}</span>
              </span>
            ))}
          </div>
        )}
        {entry.note && <p className="text-xs text-muted-foreground mt-1">{entry.note}</p>}
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{formatTimestamp(log.created_at)}</span>
    </div>
  );
}
