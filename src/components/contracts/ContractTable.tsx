import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreHorizontal,
  Edit,
  Pause,
  Play,
  X,
  Loader2,
  Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";

interface ContractData {
  id: string;
  student_id: string;
  class_id: string | null;
  start_date: string;
  end_date: string;
  monthly_amount: number;
  discount: number;
  status: "active" | "suspended" | "cancelled";
  created_at: string;
  updated_at: string;
  students: {
    full_name: string;
  } | null;
  classes: {
    name: string;
  } | null;
}

interface ContractTableProps {
  data: ContractData[];
  loading: boolean;
  onEdit: (contract: ContractData) => void;
  onRefresh: () => void;
}

export function ContractTable({ data, loading, onEdit, onRefresh }: ContractTableProps) {
  const { toast } = useToast();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => data.filter(c => {
    const matchesSearch = !search || (c.students?.full_name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [data, search, statusFilter]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-500 text-white">Ativo</Badge>;
      case "suspended":
        return <Badge className="bg-yellow-500 text-slate-900">Suspenso</Badge>;
      case "cancelled":
        return <Badge className="bg-red-500 text-white">Cancelado</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const handleStatusChange = async (contractId: string, newStatus: "active" | "suspended" | "cancelled") => {
    try {
      setActionLoading(contractId);
      const { error } = await supabase
        .from('contracts')
        .update({ status: newStatus })
        .eq('id', contractId);

      if (error) throw error;

      toast({
        title: "Sucesso",
        description: `Contrato ${newStatus === 'active' ? 'ativado' : newStatus === 'suspended' ? 'suspenso' : 'cancelado'} com sucesso`,
      });

      onRefresh();
    } catch (error) {
      console.error('Error updating contract status:', error);
      toast({
        title: "Erro",
        description: "Erro ao alterar status do contrato",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const calculateFinalAmount = (amount: number, discount: number) => {
    return amount * (1 - discount / 100);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2">Carregando contratos...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="p-4 border-b">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar aluno..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="active">Ativo</SelectItem>
              <SelectItem value="suspended">Suspenso</SelectItem>
              <SelectItem value="cancelled">Cancelado</SelectItem>
            </SelectContent>
          </Select>
          <span className="self-center text-sm text-muted-foreground whitespace-nowrap">
            {filtered.length} contrato{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            Nenhum contrato encontrado.
          </div>
        ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Aluno</TableHead>
              <TableHead>Turma</TableHead>
              <TableHead>Valor Base</TableHead>
              <TableHead>Desconto</TableHead>
              <TableHead>Valor Final</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[70px]">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((contract) => (
              <TableRow key={contract.id}>
                <TableCell className="font-medium">
                  {contract.students?.full_name || "N/A"}
                </TableCell>
                <TableCell>
                  {contract.classes?.name || "Sem turma"}
                </TableCell>
                <TableCell>
                  {formatCurrency(contract.monthly_amount)}
                </TableCell>
                <TableCell>
                  {contract.discount}%
                </TableCell>
                <TableCell className="font-medium">
                  {formatCurrency(calculateFinalAmount(contract.monthly_amount, contract.discount))}
                </TableCell>
                <TableCell>
                  <div className="text-sm">
                    <div>{format(parseISO(contract.start_date), "dd/MM/yyyy")}</div>
                    <div className="text-muted-foreground">
                      até {format(parseISO(contract.end_date), "dd/MM/yyyy")}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {getStatusBadge(contract.status)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0">
                        {actionLoading === contract.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <MoreHorizontal className="h-4 w-4" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(contract)}>
                        <Edit className="mr-2 h-4 w-4" />
                        Editar
                      </DropdownMenuItem>
                      
                      {contract.status === "active" && (
                        <DropdownMenuItem 
                          onClick={() => handleStatusChange(contract.id, "suspended")}
                        >
                          <Pause className="mr-2 h-4 w-4" />
                          Suspender
                        </DropdownMenuItem>
                      )}
                      
                      {contract.status === "suspended" && (
                        <DropdownMenuItem 
                          onClick={() => handleStatusChange(contract.id, "active")}
                        >
                          <Play className="mr-2 h-4 w-4" />
                          Reativar
                        </DropdownMenuItem>
                      )}
                      
                      {contract.status !== "cancelled" && (
                        <DropdownMenuItem 
                          onClick={() => handleStatusChange(contract.id, "cancelled")}
                          className="text-destructive"
                        >
                          <X className="mr-2 h-4 w-4" />
                          Cancelar
                        </DropdownMenuItem>
                      )}
                      
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        )}
      </CardContent>
    </Card>
  );
}