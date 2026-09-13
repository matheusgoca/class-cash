import { Bug } from "lucide-react";
import { DebugReportsSection } from "@/components/master/DebugReportsSection";

export default function MasterBugs() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-white">
          <Bug className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Relatórios de Bug</h1>
          <p className="text-sm text-muted-foreground">Problemas reportados pelas escolas</p>
        </div>
      </div>

      <DebugReportsSection />
    </div>
  );
}
