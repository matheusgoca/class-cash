import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Eye } from "lucide-react";
import { useMasterAdmin } from "@/contexts/MasterAdminContext";

export function MasterBanner() {
  const { viewingSchoolId, viewingSchoolName, exitSchool } = useMasterAdmin();
  const navigate = useNavigate();

  if (!viewingSchoolId) return null;

  return (
    <div className="bg-amber-500 text-white px-4 py-2 flex items-center gap-3 text-sm">
      <Eye className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1">
        Você está visualizando: <strong>{viewingSchoolName}</strong>
      </span>
      <Button
        size="sm"
        onClick={() => { exitSchool(); navigate("/master"); }}
        className="gap-1 h-7 text-xs bg-white text-amber-700 hover:bg-amber-50 border-0"
      >
        <ArrowLeft className="h-3 w-3" />
        Voltar ao painel master
      </Button>
    </div>
  );
}
